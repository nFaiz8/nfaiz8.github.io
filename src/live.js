// Multiplayer glue: connects (src/net.js), keeps peer state (src/peers.js) and turns it into things to draw.
import { MULTIPLAYER } from './config.js';
import { createNet } from './net.js';
import { createPeers } from './peers.js';
import { createPeers3d, wirePos } from './rpg/peers3d.js';
import { clockOffset } from './rpg/train.js';

const BG = [7, 8, 11];
const mix = (c, a) => c.map((v, i) => Math.round(BG[i] + (v - BG[i]) * a));

// A stable, light colour per connection. Hues 20°–60° are left to the arena's amber.
export function peerColor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = (61 + h % 318) % 360, s = 0.55, l = 0.7;
  const k = (n) => (n + hue / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
}

const row = (text, cx, y, color) => [...text].map((glyph, i) => ({ x: Math.floor(cx) - Math.floor(text.length / 2) + i + 0.5, y, glyph, color }));

// muted: ids whose chat is hidden. figure: false leaves out the @ (for my own echo, drawn separately).
export function peerEntities(list, { reducedMotion, muted, figure = true } = {}) {
  const out = [];
  for (const p of list) {
    const color = mix(peerColor(p.id), p.alpha);
    if (figure) out.push({ x: p.x, y: p.y, glyph: '@', color });
    if (p.name) out.push(...row(p.name, p.x, p.y + 1, mix([150, 147, 140], p.alpha)));
    const say = p.say && !(muted && muted.has(p.id)) ? p.say : null;
    if (say) out.push(...row(say, p.x, p.y - 1, mix([236, 232, 222], p.alpha)));
    if (p.emote) {
      const lift = reducedMotion ? 0 : -Math.min(1, p.emoteAge * 3) * 0.5;
      out.push(...row(p.emote, p.x, p.y - (say ? 2 : 1) + lift, color));
    }
  }
  return out;
}

export function heartEntities(hearts, frames, { reducedMotion, posOf = () => null } = {}) {
  const out = [];
  for (const h of hearts) {
    const f = frames.find((fr) => fr.id === h.f);
    if (!f) continue;
    const rise = reducedMotion ? 0 : h.age * 3;
    const color = mix([235, 96, 120], 1 - h.age * 0.8);
    if (f.backdrop) {
      // The arena's photo is the whole back wall and its top edge is the ceiling: rise from above the sender's head instead.
      const p = posOf(h.id);
      if (p) out.push({ x: p.x, y: p.y - 2.2 - rise, glyph: '♥', color });
      continue;
    }
    out.push({ x: f.x + f.w / 2, y: f.y - 0.5 - rise, glyph: '♥', color });
  }
  return out;
}

// Sends my position whenever it changes (walking, or a jump such as stepping through photos), and keeps
// trying until a send goes out. The net throttles it to 5 a second and always sends the last one.
export function positionTicker(send) {
  let sent = null;
  const tick = (player) => {
    const x = Math.round(player.x * 10) / 10, y = Math.round(player.y * 10) / 10;
    if (sent && sent.x === x && sent.y === y) return;
    if (send({ t: 'p', x, y })) sent = { x, y };
  };
  // Forget the last position so the next tick sends it again (after leaving the arena).
  tick.reset = () => { sent = null; };
  return tick;
}

// The arena state stream: snap is { x, y, vx, vy, f, g, i, a, ts } in arena-local cells. Sends at most
// every `every` ms while something moves; input, ground and facing changes (or urgent) go after `gap` ms;
// never more than `cap` in any second. A send that fails is retried on the next call. force sends a state
// out of turn (ahead of a shot), counted against the cap like any other; false only when the cap is full.
export function arenaTicker(send, { every = 67, gap = 30, cap = 20 } = {}) {
  const r = (v, d) => Math.round(v * d) / d;
  let last = null, lastAt = -Infinity, pend = false;
  let sent = [];
  const changed = (a, b) => !b || a.x !== b.x || a.y !== b.y || a.vx !== b.vx || a.vy !== b.vy || a.i !== b.i || a.g !== b.g || a.f !== b.f || Math.abs(a.a - b.a) > 0.05;
  const round = (snap) => ({ ...snap, x: r(snap.x, 100), y: r(snap.y, 100), a: r(snap.a, 100), vx: r(snap.vx, 10), vy: r(snap.vy, 10) });
  const full = (now) => { sent = sent.filter((t) => now - t < 1000); return sent.length >= cap; };
  const go = (c, now) => { if (send({ t: 'a', ...c })) { last = c; lastAt = now; pend = false; sent.push(now); } };
  const tick = (snap, now, urgent = false) => {
    const c = round(snap);
    if (full(now)) return;
    const urg = urgent || (last && (c.i !== last.i || c.g !== last.g || c.f !== last.f));
    let due = false;
    if (pend || urg) {
      if (now - lastAt >= gap) due = true; else pend = true;
    } else if (changed(c, last) && now - lastAt >= every - 1) due = true;
    if (due) go(c, now);
  };
  tick.force = (snap, now) => {
    if (full(now)) return false;
    go(round(snap), now);
    return true;
  };
  return tick;
}

// Where I am in the station, sent whenever it changes (by 0.01, or the yaw by 0.05), through the same throttle.
export function stationTicker(send) {
  let sent = null;
  const tick = (pos) => {
    const w = wirePos(pos);
    if (sent && sent.x === w.x && sent.z === w.z && sent.y === w.y && Math.abs((sent.a ?? 0) - (w.a ?? 0)) < 0.05) return;
    if (send({ t: 'q', ...w })) sent = w;
  };
  tick.reset = () => { sent = null; };
  return tick;
}

// Messages about the people in my area (station spec, Multiplayer): between asking to move and the server's
// answer (zw), any of these still come from the area I've left, and are dropped.
const AREA_T = new Set(['join', 'leave', 'p', 'q', 'e', 'r', 'c', 'n']);
const ARENA_T = new Set(['aw', 'aj', 'ax', 'a', 's', 'pk', 'w', 'mm', 'h', 'k', 'sp']);

// Where the multiplayer server is: local dev and tests never join the real gallery (on localhost only
// ?live=<ws url> connects); null when it's off.
export function liveTarget(url = MULTIPLAYER.url) {
  const onLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  const target = onLocalhost ? new URLSearchParams(location.search).get('live') : url;
  return MULTIPLAYER.enabled && target ? target : null;
}

// The arena's map as the server has it (gorge addendum), asked over HTTP before the page builds, so the
// right one is built from the start: a map name, or null if there's no server or it doesn't answer soon.
export async function fetchArenaMap(ms = 1500) {
  const target = liveTarget();
  if (!target) return null;
  try {
    const res = await fetch(`${target.replace(/^ws/, 'http')}/map`, { signal: AbortSignal.timeout(ms), cache: 'no-store' });
    const m = await res.json();
    return typeof m.map === 'string' ? m.map : null;
  } catch { return null; }
}

// onMap(name): the server's arena map, from the welcome and whenever an admin switches it. onAdmin(ok,
// map): the answer to admin().
// Areas (station spec, Multiplayer): one connection, in the gallery or the station. area(name) moves it; the
// station's people are in `station` (peers3d.js) and the gallery's in `peers`. getStationPos() is where I am
// below; onStation(n) hears how many are down there (for the lobby's sign). An old server (its welcome has no
// area) knows nothing of areas: then the station is off the net, as before.
export function createLive({ version, url = MULTIPLAYER.url, getName, getPos, getStationPos = () => null, onStation = () => {}, onAnnounce, onCount, onRejected, onChat = () => {}, onChatRejected = () => {}, onChatMuted = () => {}, onState = () => {}, fightHash = '', onArena = () => {}, inArena = () => false, onMap = () => {}, onAdmin = () => {} }) {
  const target = liveTarget(url);
  if (!target) return null;
  const peers = createPeers(), station = createPeers3d();
  let count = 0, fightOk = false, area = 'gallery', waiting = false, areas = null, offset = 0, below = 0;
  const setBelow = (n) => { n = Math.max(0, n | 0); if (n !== below) { below = n; onStation(n); } };
  const recount = () => { count = peers.count(); onCount(count); };
  const net = createNet({
    url: target, version, name: getName(),
    getPos: (a) => (a === 'station' ? (() => { const p = getStationPos(); return p && wirePos(p); })() : getPos()),
    onState: (s) => {
      // Without a connection nobody is really here any more: fade them out and hide the counts.
      if (s !== 'live' && s !== 'connecting') {
        if (peers.count()) { peers.dropAll(performance.now()); onCount(0); }
        station.clear();
        setBelow(0);
      }
      onState(s);
    },
    onMessage: (m) => {
      const now = performance.now();
      if (m.t === 'welcome') {
        areas = m.area !== undefined;
        if (Number.isFinite(m.now)) offset = clockOffset(m.now, net.ping, epoch());
        setBelow(m.station || 0);
        const where = m.area || 'gallery';
        waiting = where !== area; // the net moves me on now (a move asked for while the hi was out)
        if (!areas && area === 'station') { net.pause(); return; } // an old server: off the net below
        // Its peers are the hi's area's: the gallery's, the station's, or (moving on) neither.
        if (where === 'station' && !waiting) station.reset(m.peers, now); else station.clear();
        if (where !== 'gallery' || waiting) m = { ...m, peers: [] };
      }
      if (m.t === 'zw') {
        if (m.area !== area) return; // an answer to a move I've since changed my mind about
        waiting = false;
        if (area === 'station') station.reset(m.peers, now);
        else { peers.apply({ t: 'welcome', id: peers.myId, peers: m.peers }, now); recount(); }
        return;
      }
      if (m.t === 'zc') return setBelow(m.station);
      if (AREA_T.has(m.t) && (waiting || area === 'station')) {
        if (!waiting) station.apply(m, now);
        return;
      }
      if (m.t === 'name-rejected') return onRejected();
      if (m.t === 'chat-rejected') return onChatRejected();
      if (m.t === 'chat-muted') return onChatMuted(Number(m.s) || 0);
      if (m.t === 'am-ok' || m.t === 'am-no') return onAdmin(m.t === 'am-ok', m.map);
      if (m.t === 'map') return onMap(m.map);
      if (m.t === 'join') onAnnounce('join', m);
      if (m.t === 'leave') { const p = peers.get(m.id); if (p) onAnnounce('leave', { ...m, name: p.name, x: p.track.at(-1).x, y: p.track.at(-1).y }); }
      peers.apply(m, now);
      if (m.t === 'welcome') {
        fightOk = !!fightHash && m.fight === fightHash;
        if (fightHash && !fightOk) console.warn('arena: server level differs; no fighting'); // fighting off: nothing to differ
        if (typeof m.map === 'string') onMap(m.map);
      }
      if (ARENA_T.has(m.t)) onArena(m);
      if (m.t === 'c') { const p = peers.get(m.id); if (p) onChat({ id: m.id, name: p.name, text: m.text }); }
      if (m.t === 'welcome' || m.t === 'join' || m.t === 'leave') recount();
    },
  });
  // Hidden for 30 s: off the net. Back: the hi rejoins the area I'm in (not below on an old server).
  addEventListener('visibilitychange', () => {
    clearTimeout(createLive.hideTimer);
    if (document.hidden) createLive.hideTimer = setTimeout(() => { net.pause(); peers.clear(); station.clear(); onCount(0); setBelow(0); }, 30000);
    else if (!(areas === false && area === 'station')) net.resume();
  });
  const tick = positionTicker((m) => net.send(m));
  const tickBelow = stationTicker((m) => net.send(m));
  return {
    net, peers,
    get fightOk() { return fightOk; },
    // Called every frame. Inside the arena the arena stream replaces position messages.
    tick: (player) => { if (area === 'gallery' && !inArena()) tick(player); },
    // Called every frame in the station: where I am there ({ x, z, y, a }).
    tickStation: (pos) => { if (area === 'station') tickBelow(pos); },
    station,
    get areaName() { return area; },
    get stationCount() { return below; },
    // The server's clock now, in ms since 1970 (this machine's until a welcome has said).
    serverNow: () => epoch() + offset,
    send: (m) => net.send(m),
    leftArena: () => tick.reset(),
    get rtt() { return net.ping; },
    emote: (e) => net.send({ t: 'e', e }),
    heart: (f) => net.send({ t: 'r', f }),
    chat: (text) => net.send({ t: 'c', text }),
    admin: (map, pw) => net.send({ t: 'am', map, pw }),
    setName: (n) => net.setName(n),
    // To another area: the people I could see go at once, the new area's come with the server's answer.
    area(a) {
      if (a === area) return;
      area = a;
      waiting = true;
      if (a === 'station') { peers.apply({ t: 'welcome', id: peers.myId, peers: [] }, performance.now()); onCount(0); tickBelow.reset(); }
      else { station.clear(); tick.reset(); }
      if (areas === false) { if (a === 'station') { clearTimeout(createLive.hideTimer); net.pause(); } else net.resume(); return; }
      net.setArea(a);
    },
    get state() { return net.state; },
  };
}

const epoch = () => performance.timeOrigin + performance.now();

// What I do shows on my own screen straight away, with the same limits the server enforces.
export function localEcho() {
  const me = createPeers({ delay: 0 });
  me.apply({ t: 'welcome', id: 'me', peers: [{ id: 'me', name: '', x: 0, y: 0 }] }, 0);
  let lastEmote = -Infinity, lastHeart = -Infinity, lastSay = -Infinity;
  return {
    emote(kind, now) {
      if (now - lastEmote < 1000) return false;
      lastEmote = now;
      me.apply({ t: 'e', id: 'me', e: kind }, now);
      return true;
    },
    say(text, now) {
      if (now - lastSay < 2000) return false;
      lastSay = now;
      me.apply({ t: 'c', id: 'me', text }, now);
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
      if (p && (p.emote || p.say)) out.push(...peerEntities([{ ...p, id: 'me', name: '', x: player.x, y: player.y }], { ...opts, figure: false }));
      out.push(...heartEntities(me.hearts(now), frames, { ...opts, posOf: () => player }));
      return out;
    },
  };
}
