// One gallery instance: up to 30 people. Relays each message to everyone else as it arrives. Uses the
// hibernation API, so all per-person state lives in the socket's attachment, never in fields or storage.
// The one exception is the arena fight: the referee (bullets in flight, when each pickup was taken) and
// a 33 ms tick while bullets fly live in memory. Losing them to an eviction costs nothing.
import { DurableObject } from 'cloudflare:workers';
import {
  LIMITS, cleanName, cleanText, parseMessage, newBuckets, take, takeShot, clampMove, senderClock, sentAt, newFlood, dropped,
} from './rules.js';
import { createReferee, newFighter } from '../src/referee.js';
import { parseLevel, levelKind, levelHash, SOLID } from '../src/level.js';
import { GUNS, FIGHT_VERSION } from '../src/fight.js';
import levelText from '../src/arena.txt';

const KIND = { p: 'p', e: 'e', r: 'r', n: 'n', c: 'c' };
const ARENA = new Set(['ae', 'al', 'a', 'f', 'm', 'pk', 'rs']);
const LEVEL = parseLevel(levelText);
const LEVEL_HASH = `${levelHash(levelText)}.${FIGHT_VERSION}`; // the level and the fight's wire version
const kindAt = levelKind(LEVEL);
const TICK_MS = 33;
const KICK_GAP = 0.5; // s: after a kick, the next strike waits this long (the 0.55 s cooldown less jitter)
const GAP_MAX = 300; // ms: a pause banks no more speed than this
// The door is the level's D: the 3 rows of the east wall ending on its row (src/layout.js lines the corridor
// up with it); a body standing in it is centred there. Every honest entrance (walking in, an arena link, a
// teleport) puts you there.
const DOOR_AT = LEVEL.door || { r: LEVEL.rows - 1, x: LEVEL.cols - 0.5, y: LEVEL.rows - 1.5 };
const DOOR = { x: DOOR_AT.x, y: DOOR_AT.y };

// A body's centre inside a wall: a ▓, or anywhere outside the grid but the door.
function inWall(x, y) {
  const c = Math.floor(x), r = Math.floor(y);
  if (c >= LEVEL.cols && r >= DOOR_AT.r - 2 && r <= DOOR_AT.r) return false;
  return kindAt(c, r) === SOLID;
}
const far = (p, q) => Math.max(Math.abs(p.x - q.x), Math.abs(p.y - q.y));
const r2 = (v) => Math.round(v * 100) / 100;

async function ipTag(ip) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`faiz-live:${ip}`));
  return 'ip:' + [...new Uint8Array(d).slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const randomId = () => [...crypto.getRandomValues(new Uint8Array(6))].map((b) => b.toString(36).padStart(2, '0')).join('').slice(0, 8);

export class Gallery extends DurableObject {
  async fetch(req) {
    const tag = await ipTag(req.headers.get('CF-Connecting-IP') || 'unknown');
    if (this.ctx.getWebSockets(tag).length >= LIMITS.perIp) return new Response('too many connections', { status: 429 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, [tag]);
    const now = Date.now();
    server.serializeAttachment({ id: randomId(), name: '', x: 0, y: 0, here: false, buckets: newBuckets(now), flood: newFlood(now) });
    if (this.ctx.getWebSockets().length > LIMITS.people) {
      server.send(JSON.stringify({ t: 'full' }));
      server.close(4000, 'full');
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  others(ws) {
    return this.ctx.getWebSockets().filter((o) => o !== ws && o.deserializeAttachment()?.here);
  }
  broadcast(ws, msg) {
    const text = JSON.stringify(msg);
    for (const o of this.others(ws)) { try { o.send(text); } catch {} }
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
      if (m.x !== undefined) { me.x = m.x; me.y = m.y; }
      me.here = true;
      me.fx = newFighter(me.id, now / 1000);
      me.clk = senderClock();
      ws.serializeAttachment(me);
      const peers = this.others(ws).map((o) => { const a = o.deserializeAttachment(); return { id: a.id, name: a.name, x: a.x, y: a.y }; });
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, peers, fight: LEVEL_HASH }));
      this.broadcast(ws, { t: 'join', id: me.id, name: me.name, x: me.x, y: me.y });
      return;
    }
    if (ARENA.has(m.t)) return this.fight(ws, me, m, now, drop);
    if (!me.here || !take(me.buckets, KIND[m.t], now)) return drop();
    if (m.t === 'p') { me.x = m.x; me.y = m.y; this.broadcast(ws, { t: 'p', id: me.id, x: m.x, y: m.y }); }
    else if (m.t === 'e') this.broadcast(ws, { t: 'e', id: me.id, e: m.e });
    else if (m.t === 'r') this.broadcast(ws, { t: 'r', id: me.id, f: m.f });
    else if (m.t === 'n') {
      const name = cleanName(m.name);
      if (name === null) ws.send(JSON.stringify({ t: 'name-rejected' }));
      else { me.name = name; this.broadcast(ws, { t: 'n', id: me.id, name }); }
    } else if (m.t === 'c') {
      const text = cleanText(m.text);
      if (text === null) ws.send(JSON.stringify({ t: 'chat-rejected' }));
      else this.broadcast(ws, { t: 'c', id: me.id, text });
    }
    ws.serializeAttachment(me);
  }

  // The arena. Fighter records live in the attachments: each handler reads them, the referee changes
  // them in place, and every one it may have touched is written back before the handler returns.
  referee() {
    return this.ref || (this.ref = createReferee({ level: LEVEL, rand: Math.random }));
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

  fight(ws, me, m, now, drop) {
    if (!me.here) return drop();
    const ref = this.referee();
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
        t: 'aw', lv: LEVEL_HASH, you: { hp: F.hp, kills: F.kills, w: GUNS[F.gun].code, ammo: F.ammo },
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
      if (inWall(s.x, s.y)) return ws.serializeAttachment(me); // dropped, but the bucket and clock moved
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
    if (me?.here && me.fx?.arena) {
      const pairs = this.arena(ws, me);
      const out = this.referee().leave(me.fx, Date.now() / 1000, pairs.map(([, a]) => a.fx));
      this.tell(pairs, out, ws);
      this.save(pairs.filter(([o]) => o !== ws));
    }
    if (me?.here) { me.here = false; try { ws.serializeAttachment(me); } catch {} this.broadcast(ws, { t: 'leave', id: me.id }); }
  }
}
