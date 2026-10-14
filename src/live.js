// Multiplayer glue: connects (src/net.js), keeps peer state (src/peers.js) and turns it into things to draw.
import { MULTIPLAYER } from './config.js';
import { createNet } from './net.js';
import { createPeers } from './peers.js';

const BG = [7, 8, 11];
const mix = (c, a) => c.map((v, i) => Math.round(BG[i] + (v - BG[i]) * a));

// A stable, light colour per connection.
export function peerColor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = h % 360, s = 0.55, l = 0.7;
  const k = (n) => (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

const row = (text, cx, y, color) => [...text].map((glyph, i) => ({ x: Math.floor(cx) - Math.floor(text.length / 2) + i + 0.5, y, glyph, color }));

export function peerEntities(list, { reducedMotion } = {}) {
  const out = [];
  for (const p of list) {
    const color = mix(peerColor(p.id), p.alpha);
    out.push({ x: p.x, y: p.y, glyph: '@', color });
    if (p.name) out.push(...row(p.name, p.x, p.y + 1, mix([150, 147, 140], p.alpha)));
    if (p.emote) {
      const lift = reducedMotion ? 0 : -Math.min(1, p.emoteAge * 3) * 0.5;
      out.push(...row(p.emote, p.x, p.y - 1 + lift, color));
    }
  }
  return out;
}

export function heartEntities(hearts, frames, { reducedMotion } = {}) {
  const out = [];
  for (const h of hearts) {
    const f = frames.find((fr) => fr.id === h.f);
    if (!f) continue;
    const y = f.y - 0.5 - (reducedMotion ? 0 : h.age * 3);
    out.push({ x: f.x + f.w / 2, y, glyph: '♥', color: mix([235, 96, 120], 1 - h.age * 0.8) });
  }
  return out;
}

// Sends my position whenever it changes (walking, or a jump such as stepping through photos), and keeps
// trying until a send goes out. The net throttles it to 5 a second and always sends the last one.
export function positionTicker(send) {
  let sent = null;
  return (player) => {
    const x = Math.round(player.x * 10) / 10, y = Math.round(player.y * 10) / 10;
    if (sent && sent.x === x && sent.y === y) return;
    if (send({ t: 'p', x, y })) sent = { x, y };
  };
}

export function createLive({ version, url = MULTIPLAYER.url, getName, getPos, onAnnounce, onCount, onRejected, onState = () => {} }) {
  // Local dev and tests never join the real gallery: on localhost only ?live=<ws url> connects.
  const onLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const target = onLocalhost ? new URLSearchParams(location.search).get('live') : url;
  if (!MULTIPLAYER.enabled || !target) return null;
  const peers = createPeers();
  let count = 0;
  const net = createNet({
    url: target, version, name: getName(), getPos,
    onState: (s) => {
      // Without a connection nobody is really here any more: fade them out and hide the count.
      if (s !== 'live' && s !== 'connecting' && peers.count()) { peers.dropAll(performance.now()); onCount(0); }
      onState(s);
    },
    onMessage: (m) => {
      const now = performance.now();
      if (m.t === 'name-rejected') return onRejected();
      if (m.t === 'join') onAnnounce('join', m);
      if (m.t === 'leave') { const p = peers.get(m.id); if (p) onAnnounce('leave', { ...m, name: p.name, x: p.track.at(-1).x, y: p.track.at(-1).y }); }
      peers.apply(m, now);
      if (m.t === 'welcome' || m.t === 'join' || m.t === 'leave') { count = peers.count(); onCount(count); }
    },
  });
  addEventListener('visibilitychange', () => {
    clearTimeout(createLive.hideTimer);
    if (document.hidden) createLive.hideTimer = setTimeout(() => { net.pause(); peers.clear(); onCount(0); }, 30000);
    else net.resume();
  });
  const tick = positionTicker((m) => net.send(m));
  return {
    net, peers,
    // Called every frame.
    tick: (player) => tick(player),
    emote: (e) => net.send({ t: 'e', e }),
    heart: (f) => net.send({ t: 'r', f }),
    setName: (n) => net.setName(n),
    get state() { return net.state; },
  };
}

// What I do shows on my own screen straight away, with the same limits the server enforces.
export function localEcho() {
  const me = createPeers({ delay: 0 });
  me.apply({ t: 'welcome', id: 'me', peers: [{ id: 'me', name: '', x: 0, y: 0 }] }, 0);
  let lastEmote = -Infinity, lastHeart = -Infinity;
  return {
    emote(kind, now) {
      if (now - lastEmote < 1000) return false;
      lastEmote = now;
      me.apply({ t: 'e', id: 'me', e: kind }, now);
      return true;
    },
    heart(f, now) {
      if (now - lastHeart < 2000) return false;
      lastHeart = now;
      me.apply({ t: 'r', id: 'me', f }, now);
      return true;
    },
    entities(player, frames, now, opts) {
      const [p] = me.list(now);
      const out = [];
      if (p && p.emote) out.push(...peerEntities([{ ...p, id: 'me', name: '', x: player.x, y: player.y }], opts).filter((e) => e.glyph !== '@'));
      out.push(...heartEntities(me.hearts(now), frames, opts));
      return out;
    },
  };
}
