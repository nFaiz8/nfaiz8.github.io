// One gallery instance: up to 30 people. Relays each message to everyone else as it arrives. Uses the
// hibernation API, so all per-person state lives in the socket's attachment, never in fields or storage.
import { DurableObject } from 'cloudflare:workers';
import { LIMITS, cleanName, cleanText, parseMessage, newBuckets, take, newFlood, dropped } from './rules.js';

const KIND = { p: 'p', e: 'e', r: 'r', n: 'n', c: 'c' };

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
      ws.serializeAttachment(me);
      const peers = this.others(ws).map((o) => { const a = o.deserializeAttachment(); return { id: a.id, name: a.name, x: a.x, y: a.y }; });
      ws.send(JSON.stringify({ t: 'welcome', id: me.id, peers }));
      this.broadcast(ws, { t: 'join', id: me.id, name: me.name, x: me.x, y: me.y });
      return;
    }
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

  async webSocketClose(ws, code) {
    this.leave(ws);
    try { ws.close(code === 1005 ? 1000 : code, 'bye'); } catch {}
  }
  async webSocketError(ws) { this.leave(ws); }
  leave(ws) {
    const me = ws.deserializeAttachment();
    if (me?.here) { me.here = false; ws.serializeAttachment(me); this.broadcast(ws, { t: 'leave', id: me.id }); }
  }
}
