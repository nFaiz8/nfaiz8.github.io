// The multiplayer connection: one WebSocket to the current gallery instance. Never throws into the game.
// It's in one area at a time (station spec, Multiplayer): 'gallery' or 'station'. hi says which, and
// setArea moves (z, at most one a second, the latest wins). getPos(area) is where I am there, or null.
const MAX_INSTANCE = 10, MAX_DELAY = 60000, POS_EVERY = 200, Z_EVERY = 1000;
const POS = { p: 'gallery', q: 'station' }; // each position message and the area it's for

export function createNet({ url, version, name, getPos = () => null, onMessage, onState, WebSocketImpl = globalThis.WebSocket,
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) }, now = () => performance.now() }) {
  let ws = null, state = 'idle', instance = 1, delay = 2000, retry = null, paused = false, welcomed = false;
  let myName = name || '';
  let posTimer = null, pendingPos = null, lastPos = -Infinity, pingAt = 0, ping = null;
  // area: where I want to be; told: where the server last heard I am (by hi or z).
  let area = 'gallery', told = 'gallery', zTimer = null, lastZ = -Infinity;
  // Only the fields the server takes: gallery cells (x, y), or a station position (x, z, and y and yaw a if known).
  const posIn = (a) => {
    let p = null;
    try { p = getPos(a); } catch {}
    if (!p) return null;
    if (a === 'gallery') return { x: p.x, y: p.y };
    const o = { x: p.x, z: p.z };
    if (p.y != null) o.y = p.y;
    if (p.a != null) o.a = p.a;
    return o;
  };

  const set = (s) => { if (s !== state) { state = s; try { onState(s); } catch {} } };

  function connect() {
    retry = null;
    if (paused || state === 'gave-up') return;
    welcomed = false;
    set('connecting');
    let sock;
    try { sock = new WebSocketImpl(`${url}/room/${encodeURIComponent(version)}/${instance}`); } catch { return later(); }
    ws = sock;
    let full = false;
    sock.onopen = () => {
      pingAt = now();
      const p = posIn(area);
      told = area;
      raw({ t: 'hi', name: myName, ...(area !== 'gallery' && { area }), ...(p || {}) });
    };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'full') { full = true; return; }
      if (m.t === 'welcome') {
        welcomed = true; delay = 2000; ping = Math.round(now() - pingAt); set('live');
        if (told !== area) moveSoon(); // setArea while the hi was on its way
      }
      try { onMessage(m); } catch (err) { console.warn(err); }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      welcomed = false;
      if (full) {
        if (instance >= MAX_INSTANCE) return set('gave-up');
        instance++;
        return connect();
      }
      if (!paused) later();
    };
    sock.onerror = () => {};
  }
  function later() {
    set('waiting');
    retry = timers.setTimeout(connect, delay);
    delay = Math.min(MAX_DELAY, delay * 2);
  }
  function raw(m) {
    try { if (ws && ws.readyState === 1) { ws.send(JSON.stringify(m)); return true; } } catch {}
    return false;
  }

  function flushZ() {
    zTimer = null;
    if (!welcomed) return;
    told = area;
    lastZ = now();
    raw({ t: 'z', area, ...(posIn(area) || {}) });
  }
  function moveSoon() {
    if (zTimer) return;
    const wait = Z_EVERY - (now() - lastZ);
    if (wait <= 0) flushZ(); else zTimer = timers.setTimeout(flushZ, wait);
  }

  function flushPos() {
    posTimer = null;
    if (!pendingPos) return;
    raw(pendingPos);
    pendingPos = null;
    lastPos = now();
  }

  connect();

  return {
    // True when the message went out (or, for a position, is queued behind the throttle).
    send(m) {
      if (!welcomed) return false;
      if (!POS[m.t]) return raw(m);
      if (POS[m.t] !== told || zTimer) return false; // a position for an area the server doesn't have me in yet
      pendingPos = m;
      const wait = POS_EVERY - (now() - lastPos);
      if (wait <= 0 && !posTimer) flushPos();
      else if (!posTimer) posTimer = timers.setTimeout(flushPos, Math.max(0, wait));
      return true;
    },
    // To another area (or the same one again, for its list again): z goes now, or a second after the last.
    setArea(a) {
      area = a;
      pendingPos = null;
      if (welcomed) moveSoon();
    },
    get area() { return area; },
    setName(n) { myName = n; if (welcomed) raw({ t: 'n', name: n }); },
    pause() {
      paused = true;
      if (retry) { timers.clearTimeout(retry); retry = null; }
      if (zTimer) { timers.clearTimeout(zTimer); zTimer = null; }
      const s = ws; ws = null; welcomed = false;
      if (s) try { s.close(); } catch {}
      set('idle');
    },
    resume() { if (!paused) return; paused = false; delay = 2000; if (state !== 'gave-up') connect(); },
    close() { this.pause(); },
    get state() { return state; },
    get instance() { return instance; },
    get ping() { return ping; },
  };
}
