// Other real visitors: positions smoothed a little behind real time, emotes, hearts at photos, and who
// is still here. Pure data; main.js draws it.
export const EMOTE_GLYPH = { heart: '♥', bang: '!', ask: '?', star: '★', wave: '~o/' };
export const EMOTES_ORDER = ['heart', 'bang', 'ask', 'star', 'wave'];

export function createPeers({ delay = 250, fade = 3000, emoteFor = 2500, heartFor = 2000, sayFor = 5000 } = {}) {
  const peers = new Map(); // id → { id, name, track: [{t,x,y}], left: number|null, emote, emoteAt, dx, dy }
  let hearts = []; // { f, id, at }
  const api = {
    myId: null,
    apply(m, now) {
      if (m.t === 'welcome') {
        api.myId = m.id;
        peers.clear();
        for (const p of m.peers) add(p, now);
        return;
      }
      if (m.t === 'join') return add(m, now);
      const p = peers.get(m.id);
      if (!p) return;
      if (m.t === 'leave') { if (p.left == null) p.left = now; }
      else if (m.t === 'p') {
        const last = p.track.at(-1);
        const ddx = m.x - last.x, ddy = m.y - last.y;
        if (ddx || ddy) { const d = Math.hypot(ddx, ddy); p.dx = ddx / d; p.dy = ddy / d; }
        p.track.push({ t: now, x: m.x, y: m.y });
        if (p.track.length > 8) p.track.shift();
      } else if (m.t === 'e') { p.emote = EMOTE_GLYPH[m.e] || null; p.emoteAt = now; }
      else if (m.t === 'n') p.name = m.name;
      else if (m.t === 'c') { p.say = m.text; p.sayAt = now; }
      else if (m.t === 'r') hearts.push({ f: m.f, id: m.id, at: now });
    },
    list(now) {
      const out = [];
      for (const p of [...peers.values()]) {
        if (p.left != null && now - p.left >= fade) { peers.delete(p.id); continue; }
        const { x, y } = sample(p.track, now - delay);
        const showing = p.emote && now - p.emoteAt < emoteFor;
        out.push({ id: p.id, name: p.name, x, y, dx: p.dx, dy: p.dy, alpha: p.left == null ? 1 : 1 - (now - p.left) / fade,
          emote: showing ? p.emote : null, emoteAge: showing ? (now - p.emoteAt) / emoteFor : 0,
          say: p.say && now - p.sayAt < sayFor ? p.say : null });
      }
      return out;
    },
    hearts(now) {
      hearts = hearts.filter((h) => now - h.at < heartFor);
      return hearts.map((h) => ({ f: h.f, id: h.id, age: (now - h.at) / heartFor }));
    },
    get: (id) => peers.get(id) || null,
    count: () => [...peers.values()].filter((p) => p.left == null).length,
    clear() { peers.clear(); hearts = []; },
    // The connection is gone: everyone fades out; the next welcome rebuilds the list.
    dropAll(now) { for (const p of peers.values()) if (p.left == null) p.left = now; },
  };
  function add(p, now) {
    peers.set(p.id, { id: p.id, name: p.name || '', track: [{ t: now, x: p.x, y: p.y }], left: null, emote: null, emoteAt: 0, say: null, sayAt: 0, dx: 0, dy: 1 });
  }
  return api;
}

function sample(track, t) {
  if (t <= track[0].t) return track[0];
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return track.at(-1);
}

// A cell about two behind someone (opposite the way they last moved), for following them.
export function followCell(map, target, walkable) {
  const cx = Math.floor(target.x), cy = Math.floor(target.y);
  const bx = Math.round(cx - (target.dx || 0) * 2), by = Math.round(cy - (target.dy || 0) * 2);
  if ((bx !== cx || by !== cy) && walkable(bx, by)) return { x: bx, y: by };
  for (let r = 1; r <= 2; r++)
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (walkable(cx + dx, cy + dy)) return { x: cx + dx, y: cy + dy };
      }
  return null;
}
