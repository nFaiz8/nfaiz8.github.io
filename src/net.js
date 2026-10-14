// The multiplayer connection: one WebSocket to the current gallery instance. Never throws into the game.
const MAX_INSTANCE = 10, MAX_DELAY = 60000, POS_EVERY = 200;

export function createNet({ url, version, name, onMessage, onState, WebSocketImpl = globalThis.WebSocket,
  timers = { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (h) => clearTimeout(h) }, now = () => performance.now() }) {
  let ws = null, state = 'idle', instance = 1, delay = 2000, retry = null, paused = false, welcomed = false;
  let myName = name || '';
  let posTimer = null, pendingPos = null, lastPos = -Infinity, pingAt = 0, ping = null;

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
    sock.onopen = () => { pingAt = now(); raw({ t: 'hi', name: myName }); };
    sock.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'full') { full = true; return; }
      if (m.t === 'welcome') { welcomed = true; delay = 2000; ping = Math.round(now() - pingAt); set('live'); }
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
  function raw(m) { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(m)); } catch {} }

  function flushPos() {
    posTimer = null;
    if (!pendingPos) return;
    raw(pendingPos);
    pendingPos = null;
    lastPos = now();
  }

  connect();

  return {
    send(m) {
      if (!welcomed) return;
      if (m.t !== 'p') return raw(m);
      pendingPos = m;
      const wait = POS_EVERY - (now() - lastPos);
      if (wait <= 0 && !posTimer) flushPos();
      else if (!posTimer) posTimer = timers.setTimeout(flushPos, Math.max(0, wait));
    },
    setName(n) { myName = n; if (welcomed) raw({ t: 'n', name: n }); },
    pause() {
      paused = true;
      if (retry) { timers.clearTimeout(retry); retry = null; }
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
