// One gallery instance: up to 30 people. Relays each message to everyone else as it arrives. Uses the
// hibernation API, so all per-person state lives in the socket's attachment, never in fields or storage.
// The one exception is the arena fight: the referee (bullets in flight, when each pickup was taken) and
// a 33 ms tick while bullets fly live in memory. Losing them to an eviction costs nothing. And a chat mute
// (a slur: chat filter addendum) is kept in storage by IP, so reconnecting doesn't lift it.
// The arena's map (gorge addendum) is the whole site's: one instance, named CONFIG, keeps it in storage and
// answers /map; an admin's change (am, behind the password) is stored there and announced to every instance
// of the admin's version, which drops its fight and tells its people (map).
// Areas (station spec, Multiplayer): each connection is in the gallery (the default, all an old page knows) or
// the station, and hears p, q, e, r, c, n, join and leave only from its own area; the arena is the gallery's.
// Everyone hears how many are in the station (zc), for the lobby's sign.
import { DurableObject } from 'cloudflare:workers';
import {
  LIMITS, cleanName, cleanText, hasSlur, parseMessage, adminOk, newBuckets, take, takeShot, clampMove, senderClock, sentAt, newFlood, dropped,
} from './rules.js';
import { createReferee, newFighter } from '../src/referee.js';
import { parseMap, levelKind, levelHash, mapName, SOLID, DEFAULT_MAP } from '../src/level.js';
import { GUNS, FIGHT_VERSION } from '../src/fight.js';
import trainText from '../src/arena.txt';
import gorgeText from '../src/gorge.txt';

const KIND = { p: 'p', q: 'q', z: 'z', e: 'e', r: 'r', n: 'n', c: 'c' };
const ARENA = new Set(['ae', 'al', 'a', 'f', 'm', 'pk', 'rs']);
const TICK_MS = 33;
const KICK_GAP = 0.5; // s: after a kick, the next strike waits this long (the 0.55 s cooldown less jitter)
const GAP_MAX = 300; // ms: a pause banks no more speed than this
// Each map's level: its hash (with the fight's wire version), its cells, and its door: the level's D, the 3
// rows of the east wall ending on its row (src/layout.js lines the corridor up with it); a body standing in
// it is centred there. Every honest entrance (walking in, an arena link, a teleport) puts you there.
function levelOf(name, text) {
  const level = parseMap(name, text), at = level.door || { r: level.rows - 1, x: level.cols - 0.5, y: level.rows - 1.5 };
  const kindAt = levelKind(level);
  // A body's centre inside a wall: a ▓, or anywhere outside the grid but the door.
  const inWall = (x, y) => {
    const c = Math.floor(x), r = Math.floor(y);
    if (c >= level.cols && r >= at.r - 2 && r <= at.r) return false;
    return kindAt(c, r) === SOLID;
  };
  return { name, level, hash: `${levelHash(text)}.${FIGHT_VERSION}`, door: { x: at.x, y: at.y }, inWall };
}
const LEVELS = { train: levelOf('train', trainText), gorge: levelOf('gorge', gorgeText) };
const CONFIG = 'config'; // the instance that keeps the map
const far = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
const r2 = (v) => Math.round(v * 100) / 100;

async function ipTag(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`faiz-live:${ip}`));
  return 'ip:' + [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

export class Gallery extends DurableObject {
  // The map up, as CONFIG has it (read once while awake; an announce changes it).
  async mapName() {
    if (this.map) return this.map;
    let name;
    try {
      const res = await this.env.GALLERY.get(this.env.GALLERY.idFromName(CONFIG)).fetch('https://do/map');
      name = (await res.json()).map;
    } catch {}
    return (this.map = mapName(name));
  }
  async arenaLevel() { return LEVELS[await this.mapName()]; }

  async fetch(req) {
    const path = new URL(req.url).pathname;
    // CONFIG: what the map is, and setting it (only ever from an instance that checked the password).
    if (path === '/map') {
      if (req.method === 'POST') {
        const { map } = await req.json();
        await this.ctx.storage.put('map', mapName(map));
      }
      return Response.json({ map: mapName(await this.ctx.storage.get('map')) });
    }
    // An instance: the map changed. Out of the fight, everyone; the new map goes to all.
    if (path === '/announce') {
      const { map } = await req.json();
      this.setMap(mapName(map));
      return new Response('ok');
    }
    const room = path.match(/^\/room\/([^/]+)\/(\d{1,2})$/);
    const tag = await ipTag(req.headers.get('CF-Connecting-IP') || 'unknown');
    if (this.ctx.getWebSockets(tag).length >= LIMITS.perIp) return new Response('too many connections', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [tag]);
    const now = Date.now();
    const muteUntil = (await this.ctx.storage.get(`mute:${tag}`)) || 0;
    server.serializeAttachment({ id: randomId(), name: '', x: 0, y: 0, area: 'gallery', sp: null, here: false, buckets: newBuckets(now), flood: newFlood(now), muteUntil, tag,
      version: room ? decodeURIComponent(room[1]) : '' }); // whose instances an admin's change is announced to
    if (this.ctx.getWebSockets().length > LIMITS.people) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4000, 'full');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  // Everyone else here in an area (an attachment from before areas is in the gallery).
  others(ws, area) {
    return this.ctx.getWebSockets().filter((o) => { const a = o !== ws && o.deserializeAttachment(); return a?.here && (a.area || 'gallery') === area; });
  }
  broadcast(ws, msg, area) {
    const text = JSON.stringify(msg);
    for (const o of this.others(ws, area)) { try { o.send(text); } catch {} }
  }
  // How someone is seen in an area: gallery cells, or their station position (none until they've sent one).
  view(a, area) {
    return area === 'station' ? { id: a.id, name: a.name, ...(a.sp || {}) } : { id: a.id, name: a.name, x: a.x, y: a.y };
  }
  peersIn(ws, area) { return this.others(ws, area).map((o) => this.view(o.deserializeAttachment(), area)); }
  stationCount() {
    let n = 0;
    for (const o of this.ctx.getWebSockets()) { const a = o.deserializeAttachment(); if (a?.here && a.area === 'station') n++; }
    return n;
  }
  // The station's count changed: everyone here hears it.
  counted() {
    const text = JSON.stringify({ t: 'zc', station: this.stationCount() });
    for (const o of this.ctx.getWebSockets()) { if (o.deserializeAttachment()?.here) try { o.send(text); } catch {} }
  }
  // Out of the fight, as leaving the page would take you out of it (going down the stairs from inside, say).
  quitArena(ws, me) {
    if (!me.fx?.arena) return;
    const pairs = this.arena(ws, me);
    const out = (this.ref || this.referee(LEVELS[this.map || DEFAULT_MAP])).leave(me.fx, Date.now() / 1000, pairs.map(([, a]) => a.fx));
    this.tell(pairs, out, ws);
    this.save(pairs.filter(([o]) => o !== ws));
  }
  // z: to another area (or the same one again: its list again). The old area hears you leave, the new one
  // you join, where you said you are; you get who's there.
  move(ws, me, m) {
    const from = me.area || 'gallery', to = m.area;
    if (from !== to) {
      if (from === 'gallery') this.quitArena(ws, me);
      this.broadcast(ws, { t: 'leave', id: me.id }, from);
      me.area = to;
      if (to === 'station') me.sp = null;
    }
    if (m.x !== undefined) {
      if (to === 'station') me.sp = { ...(m.tr !== undefined && { tr: m.tr }), x: m.x, z: m.z, ...(m.y !== undefined && { y: m.y }), ...(m.a !== undefined && { a: m.a }), ...(m.s !== undefined && { s: m.s }) };
      else { me.x = m.x; me.y = m.y; }
    }
    ws.serializeAttachment(me);
    ws.send(JSON.stringify({ t: 'zw', area: to, peers: this.peersIn(ws, to), now: Date.now() }));
    if (from !== to) {
      this.broadcast(ws, { t: 'join', ...this.view(me, to) }, to);
      this.counted();
    }
  }

  async webSocketMessage(ws, data) {
    const me = ws.deserializeAttachment();
    if (typeof data !== 'string') return ws.close(1003, 'text only');
    if (new TextEncoder().encode(data).length > LIMITS.bytes) return ws.close(1009, 'too big');
    const now = Date.now();
    const m = parseMessage(data);
    const drop = () => {
      const flood = dropped(me.flood, now);
      ws.serializeAttachment(me);
      if (flood) ws.close(1008, 'flood');
    };
    if (!m) return drop();

    if (m.t === 'hi') {
      if (me.here) return drop();
      const name = cleanName(m.name);
      if (name === null) ws.send(JSON.stringify({ t: 'name-rejected' }));
      me.name = name || '';
      me.area = m.area || 'gallery';
      if (m.x !== undefined) {
        if (me.area === 'station') me.sp = { ...(m.tr !== undefined && { tr: m.tr }), x: m.x, z: m.z, ...(m.y !== undefined && { y: m.y }), ...(m.a !== undefined && { a: m.a }), ...(m.s !== undefined && { s: m.s }) };
        else { me.x = m.x; me.y = m.y; }
      }
      me.here = true;
      me.fx = newFighter(me.id, now / 1000);
      me.clk = senderClock();
      ws.serializeAttachment(me);
      const peers = this.peersIn(ws, me.area);
      const L = await this.arenaLevel();
      // area and now are new (station spec, Multiplayer): which area the peers are in, and the server's clock
      // for the station's shared train; station: how many are down there.
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, peers, fight: L.hash, map: L.name, area: me.area, now: Date.now(), station: this.stationCount() }));
      this.broadcast(ws, { t: 'join', ...this.view(me, me.area) }, me.area);
      if (me.area === 'station') this.counted();
      return;
    }
    if (ARENA.has(m.t) && (me.area || 'gallery') !== 'gallery') return drop(); // the arena is upstairs
    if (ARENA.has(m.t)) return this.fight(ws, me, m, now, drop, await this.arenaLevel());
    if (m.t === 'am') return this.admin(ws, me, m, now, drop);
    if (!me.here || !take(me.buckets, KIND[m.t], now)) return drop();
    const area = me.area || 'gallery';
    if (m.t === 'z') return this.move(ws, me, m);
    if ((m.t === 'p' && area !== 'gallery') || (m.t === 'q' && area !== 'station')) return drop(); // a position for the area you're not in
    if (m.t === 'p') { me.x = m.x; me.y = m.y; this.broadcast(ws, { t: 'p', id: me.id, x: m.x, y: m.y }, area); }
    else if (m.t === 'q') { const { t, ...sp } = m; me.sp = sp; this.broadcast(ws, { t: 'q', id: me.id, ...sp }, area); }
    else if (m.t === 'e') this.broadcast(ws, { t: 'e', id: me.id, e: m.e }, area);
    else if (m.t === 'r') this.broadcast(ws, { t: 'r', id: me.id, f: m.f }, area);
    else if (m.t === 'n') {
      const name = cleanName(m.name);
      if (name === null) ws.send(JSON.stringify({ t: 'name-rejected' }));
      else { me.name = name; this.broadcast(ws, { t: 'n', id: me.id, name }, area); }
    } else if (m.t === 'c') {
      // A slur mutes the sender's chat (and their IP's) for LIMITS.muteS; swears are sent censored.
      if (hasSlur(m.text)) {
        me.muteUntil = now + LIMITS.muteS * 1000;
        if (me.tag) await this.ctx.storage.put(`mute:${me.tag}`, me.muteUntil);
      }
      const text = cleanText(m.text);
      if ((me.muteUntil || 0) > now) ws.send(JSON.stringify({ t: 'chat-muted', s: Math.ceil((me.muteUntil - now) / 1000) }));
      else if (text === null) ws.send(JSON.stringify({ t: 'chat-rejected' }));
      else this.broadcast(ws, { t: 'c', id: me.id, text }, area);
    }
    ws.serializeAttachment(me);
  }

  // The admin's map switch: the password checked here, the map kept by CONFIG, then announced to every
  // instance of this version (this one too). A wrong password says so; the bucket keeps guessing slow.
  async admin(ws, me, m, now, drop) {
    if (!me.here || !take(me.buckets, 'am', now)) return drop();
    ws.serializeAttachment(me);
    if (!(await adminOk(m.pw))) return ws.send(JSON.stringify({ t: 'am-no' }));
    const body = JSON.stringify({ map: m.map });
    await this.env.GALLERY.get(this.env.GALLERY.idFromName(CONFIG)).fetch('https://do/map', { method: 'POST', body });
    ws.send(JSON.stringify({ t: 'am-ok', map: m.map }));
    this.setMap(m.map);
    const others = [];
    for (let n = 1; n <= LIMITS.instances; n++) {
      const name = `${me.version}#${n}`, id = this.env.GALLERY.idFromName(name);
      if (id.equals(this.ctx.id)) continue;
      others.push(this.env.GALLERY.get(id).fetch('https://do/announce', { method: 'POST', body }).catch(() => {}));
    }
    await Promise.all(others);
  }
  // A new map: the fight starts over (nobody is in it; the referee is the new level's), and everyone here
  // hears it (map, with its fight hash: the page switches to it).
  setMap(name) {
    this.map = name;
    this.ref = null;
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
    const msg = JSON.stringify({ t: 'map', map: name, fight: LEVELS[name].hash });
    for (const o of this.ctx.getWebSockets()) {
      const a = o.deserializeAttachment();
      if (!a?.here) continue;
      if (a.fx) { a.fx = newFighter(a.id, Date.now() / 1000); try { o.serializeAttachment(a); } catch {} }
      try { o.send(msg); } catch {}
    }
  }

  // The arena. Fighter records live in the attachments: each handler reads them, the referee changes
  // them in place, and every one it may have touched is written back before the handler returns.
  referee(L) {
    if (this.ref && this.refMap !== L.name) this.ref = null;
    this.refMap = L.name;
    return this.ref || (this.ref = createReferee({ level: L.level, rand: Math.random }));
  }
  // Everyone in the fight as [socket, attachment] pairs, the sender's (already read) attachment included.
  arena(ws, me) {
    const pairs = me?.here && me.fx?.arena ? [[ws, me]] : [];
    for (const o of this.ctx.getWebSockets()) {
      if (o === ws) continue;
      const a = o.deserializeAttachment();
      if (a?.here && a.fx?.arena) pairs.push([o, a]);
    }
    return pairs;
  }
  // Arena traffic goes only to people in the arena; skip (the sender) is left out of it.
  tell(pairs, msgs, skip) {
    for (const msg of msgs) {
      const text = JSON.stringify(msg);
      for (const [o] of pairs) if (o !== skip) { try { o.send(text); } catch {} }
    }
  }
  save(pairs) {
    for (const [o, a] of pairs) { try { o.serializeAttachment(a); } catch {} }
  }
  // While bullets fly, move them every 33 ms; stop when none are left.
  startTick() {
    if (this.tickTimer || !this.ref || this.ref.live() === 0) return;
    this.tickTimer = setInterval(() => {
      let done = false;
      try {
        const pairs = this.arena();
        this.tell(pairs, this.ref.tick(Date.now() / 1000, pairs.map(([, a]) => a.fx)));
        this.save(pairs);
        done = true;
      } finally {
        // A throw stops the tick too, rather than repeating every 33 ms; the next shot starts it again.
        if (!done || !this.ref || this.ref.live() === 0) { clearInterval(this.tickTimer); this.tickTimer = null; }
      }
    }, TICK_MS);
  }

  fight(ws, me, m, now, drop, L) {
    if (!me.here) return drop();
    const ref = this.referee(L);
    const DOOR = L.door;
    const t = now / 1000;
    const F = me.fx;
    const fighters = (pairs) => pairs.map(([, a]) => a.fx);

    if (m.t === 'ae' || m.t === 'al') {
      if (!take(me.buckets, 'ae', now)) return drop(); // one bucket for both
      const pairs = this.arena(ws, me);
      if (m.t === 'al') {
        const out = ref.leave(F, t, fighters(pairs));
        this.tell(pairs, out.filter((o) => o.t === 'k')); // the leaver hears their own flee too
        this.tell(pairs, out.filter((o) => o.t !== 'k'), ws);
        this.save(pairs.filter(([o]) => o !== ws));
        return ws.serializeAttachment(me);
      }
      // Back from being away while still inside: leave first, quietly (the k still goes out).
      if (F.arena) this.tell(pairs, ref.leave(F, t, fighters(pairs)).filter((o) => o.t !== 'ax'));
      const others = pairs.filter(([o]) => o !== ws);
      const popped = !F.alive;
      const out = ref.enter(F, t);
      F.vx = F.vy = 0;
      F.sentPrev = now;
      // The first state is clamped from the door, or from where I was if I'm back from being away.
      F.fresh = true;
      if (!F.placed) { F.x = DOOR.x; F.y = DOOR.y; }
      me.clk = senderClock(); // ts restarts at each ae
      ws.send(JSON.stringify({
        t: 'aw', lv: L.hash, you: { hp: F.hp, kills: F.kills, w: GUNS[F.gun].code, ammo: F.ammo },
        pk: ref.pickups(t), fighters: others.map(([, a]) => ref.view(a.fx, t)),
      }));
      this.tell(others, out);
      if (popped) {
        // Popped, then back in: respawn at once, past the 2 s wait (it was spent outside).
        Object.assign(F, { alive: false, deadAt: -1e9 });
        const r = ref.respawn(F, t, fighters(others));
        F.fresh = false;
        this.tell([...others, [ws, me]], r.out);
      }
      this.save(others);
      return ws.serializeAttachment(me);
    }

    if (m.t === 'pk') {
      if (!take(me.buckets, 'pk', now)) return drop();
      const r = ref.pickup(F, m.n, t);
      if (r.ok) this.tell(this.arena(ws, me), r.out);
      return ws.serializeAttachment(me);
    }

    if (!F.arena) return drop(); // a, f, m and rs need you inside

    if (m.t === 'a') {
      if (!take(me.buckets, 'a', now)) return drop();
      if (!F.alive) return ws.serializeAttachment(me); // some are always in flight when you pop: within the bucket, not a flood
      const sent = sentAt(me.clk, m.ts, now);
      const from = F.fresh && !(F.placed && far(F, m) < far(DOOR, m)) ? DOOR : F;
      const c = clampMove(from, m, Math.min(GAP_MAX, Math.max(0, sent - (F.sentPrev ?? sent))));
      const s = c === m ? m : { ...c, x: r2(c.x), y: r2(c.y) };
      if (L.inWall(s.x, s.y)) return ws.serializeAttachment(me); // dropped, but the bucket and clock moved
      ref.state(F, s, t, sent / 1000);
      F.sentPrev = Math.max(F.sentPrev ?? sent, sent); // a backdated stamp never moves it back
      F.fresh = false;
      F.placed = true;
      ws.serializeAttachment(me);
      const others = this.arena(ws, me).filter(([o]) => o !== ws);
      return this.tell(others, [{ t: 'a', id: me.id, ...s }]);
    }

    if (m.t === 'f') {
      if (!takeShot(me.buckets, F.gun, now)) return drop();
      const pairs = this.arena(ws, me);
      const r = ref.fire(F, m, t, fighters(pairs));
      if (r.ok) this.tell(pairs, r.out);
      this.save(pairs);
      return this.startTick();
    }

    if (m.t === 'm') {
      if (!take(me.buckets, 'm', now)) return drop();
      if (F.lastStrike === 'kick' && t - F.strikeAt < KICK_GAP) return drop();
      const pairs = this.arena(ws, me);
      const r = ref.strike(F, m, t, fighters(pairs));
      if (r.ok) this.tell(pairs, r.out);
      return this.save(pairs);
    }

    if (m.t === 'rs') {
      if (!take(me.buckets, 'rs', now)) return drop();
      const pairs = this.arena(ws, me);
      const r = ref.respawn(F, t, fighters(pairs));
      if (r.ok) {
        F.sentPrev = now; // the next state is measured from the spawn point, from now
        F.fresh = false;
        this.tell(pairs, r.out);
      }
      return this.save(pairs);
    }
  }

  async webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
  }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) {
    const me = ws.deserializeAttachment();
    if (me?.here) this.quitArena(ws, me);
    if (me?.here) {
      me.here = false;
      try { ws.serializeAttachment(me); } catch {}
      this.broadcast(ws, { t: 'leave', id: me.id }, me.area || 'gallery');
      if (me.area === 'station') this.counted();
    }
  }
}
