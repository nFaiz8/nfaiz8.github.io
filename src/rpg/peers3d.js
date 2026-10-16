// Other real players in the station (station spec, Multiplayer): their positions smoothed a little behind real
// time, their names, chat and emotes, and the walk each one's figure takes from how it moves. Pure: no three.js,
// no DOM; others.js draws them.
import { EMOTE_GLYPH } from '../peers.js';
import { turnToward, stepGait } from './rig.js';
import { SPEED } from './move.js';

// delay: how far behind the newest position a figure is drawn (positions come 5 a second, so a little more
// than one gap). A jump longer than JUMP between two positions (a teleport) is a jump, not a walk.
export const REMOTE = { delay: 300, jump: 3, say: 5000, emote: 2500, keep: 8 };

export function createPeers3d({ delay = REMOTE.delay, sayFor = REMOTE.say, emoteFor = REMOTE.emote } = {}) {
  const peers = new Map(); // id → { id, name, track: [{ t, x, z, y, a }], say, sayAt, emote, emoteAt }
  const add = (p, now) => {
    const q = { id: p.id, name: p.name || '', track: [], say: null, sayAt: 0, emote: null, emoteAt: 0 };
    peers.set(p.id, q);
    if (Number.isFinite(p.x) && Number.isFinite(p.z)) push(q, p, now);
  };
  return {
    // A list from the server (welcome or zw): exactly these people, where they last were.
    reset(list, now) { peers.clear(); for (const p of list) add(p, now); },
    clear() { peers.clear(); },
    apply(m, now) {
      if (m.t === 'join') return add(m, now);
      const p = peers.get(m.id);
      if (!p) return;
      if (m.t === 'leave') peers.delete(m.id);
      else if (m.t === 'q') push(p, m, now);
      else if (m.t === 'n') p.name = m.name;
      else if (m.t === 'c') { p.say = m.text; p.sayAt = now; }
      else if (m.t === 'e') { p.emote = EMOTE_GLYPH[m.e] || null; p.emoteAt = now; }
    },
    // Everyone with a position, where they are `delay` ms ago.
    list(now) {
      const out = [];
      for (const p of peers.values()) {
        if (!p.track.length) continue;
        const s = sampleTrack(p.track, now - delay);
        const emoting = p.emote && now - p.emoteAt < emoteFor;
        out.push({ id: p.id, name: p.name, x: s.x, z: s.z, y: s.y, a: s.a,
          say: p.say && now - p.sayAt < sayFor ? p.say : null,
          emote: emoting ? p.emote : null, emoteAge: emoting ? (now - p.emoteAt) / emoteFor : 0 });
      }
      return out;
    },
    get: (id) => peers.get(id) || null,
    count: () => peers.size,
  };
}

function push(p, m, now) {
  const pt = { t: now, x: m.x, z: m.z, y: Number.isFinite(m.y) ? m.y : null, a: Number.isFinite(m.a) ? m.a : null };
  const last = p.track.at(-1);
  if (!last || Math.hypot(pt.x - last.x, pt.z - last.z) > REMOTE.jump) { p.track = [pt]; return; }
  p.track.push(pt);
  if (p.track.length > REMOTE.keep) p.track.shift();
}

// The position at time t along a track: between the two around it, the first before it starts, the last after
// it ends. y between two floors and the yaw are the latest known at t (the yaw isn't blended: the walk turns it).
export function sampleTrack(track, t) {
  if (t <= track[0].t) return { ...track[0] };
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1], b = track[i];
    if (t <= b.t) {
      const k = (t - a.t) / (b.t - a.t || 1);
      const y = a.y != null && b.y != null ? a.y + (b.y - a.y) * k : b.y ?? a.y;
      return { t, x: a.x + (b.x - a.x) * k, z: a.z + (b.z - a.z) * k, y, a: a.a ?? b.a };
    }
  }
  return { ...track.at(-1) };
}

// A figure's walk from where it's drawn, frame to frame, as the commuters' is: facing where it goes (or the
// yaw it sent, standing), turning on the rig's spring, the stride following the ground it covers. r is
// { x, z, yaw, phase, gait, target } or empty for a new figure (it then starts standing where s is).
const MOVING = 0.3; // units a second: slower than this is standing
export function stepRemote(r, s, dt) {
  if (r.x === undefined || Math.hypot(s.x - r.x, s.z - r.z) > REMOTE.jump) {
    Object.assign(r, { x: s.x, z: s.z, yaw: s.a ?? r.yaw ?? 0, phase: r.phase ?? 0, gait: 0 });
    r.target = r.yaw;
    return r;
  }
  const dx = s.x - r.x, dz = s.z - r.z, d = Math.hypot(dx, dz);
  if (dt > 0 && d / dt > MOVING) r.target = Math.atan2(dx, dz);
  else if (s.a != null) r.target = s.a;
  r.yaw = turnToward(r.yaw, r.target, dt);
  stepGait(r, dx, dz, dt, SPEED);
  r.x = s.x; r.z = s.z;
  return r;
}

// A station position for the wire: to 0.01, the yaw wrapped into [-π, π].
const q = (v) => Math.round(v * 100) / 100;
export function wirePos({ x, z, y, a }) {
  const o = { x: q(x), z: q(z) };
  if (Number.isFinite(y)) o.y = q(y);
  if (Number.isFinite(a)) { const w = a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI)); o.a = Math.max(-3.14, Math.min(3.14, q(w))); }
  return o;
}
