import { SITE } from './config.js';
import { createLive, peerEntities, heartEntities, localEcho } from './live.js';
import { EMOTES_ORDER, EMOTE_GLYPH, followCell } from './peers.js';
import { cleanName } from '../server/rules.js';
import { loadData, captionText, describe } from './data.js';
import { buildLayout, isWalkable } from './layout.js';
import { createWorld, step, walkTo, frameAtCell, teleport, roomAt } from './world.js';
import { createInput } from './input.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createGlRenderer } from './render/gl.js';
import { C } from './render/palette.js';
import { createLighting } from './light.js';
import { createViewer } from './viewer.js';
import { parseRoute, photoHash, roomHash, replaceHash, ALL_HASH } from './router.js';
import { createMap } from './map.js';
import { createGrid } from './grid.js';

const stage = document.getElementById('stage');
const captionEl = document.getElementById('caption');
const noteEl = document.getElementById('note');
const rendererBtn = document.getElementById('renderer-btn');
const debugEl = document.getElementById('debug');
document.getElementById('hud-name').textContent = SITE.name;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const debug = new URLSearchParams(location.search).has('debug');
const RENDERERS = { canvas: createCanvasRenderer, gl: createGlRenderer };

let map, world, renderer, input, viewer, mapView, grid;

function note(text, ms = 3000) {
  noteEl.textContent = text;
  noteEl.classList.add('on');
  clearTimeout(note.t);
  note.t = setTimeout(() => noteEl.classList.remove('on'), ms);
}

function fatal(err) {
  const box = document.createElement('div');
  box.className = 'fatal';
  const pre = document.createElement('pre');
  const msg = String(err.message || err).slice(0, 60);
  const w = Math.max(42, msg.length + 4);
  const line = (t = '') => `|  ${t.padEnd(w - 4)}  |`;
  pre.textContent = [`+${'-'.repeat(w)}+`, line("the gallery couldn't load"), line(msg), line(), ''].join('\n');
  const a = document.createElement('a');
  a.href = '';
  a.textContent = 'try again';
  pre.append(`|  `, a, `${' '.repeat(w - 4 - 9)}  |\n+${'-'.repeat(w)}+`);
  box.append(pre);
  document.body.replaceChildren(box);
}

// A canvas can only ever have one kind of context, so each renderer gets a fresh one.
function setRenderer(name) {
  if (renderer) renderer.dispose();
  stage.replaceChildren();
  const canvas = document.createElement('canvas');
  stage.append(canvas);
  try {
    renderer = RENDERERS[name]();
    renderer.init(canvas, map);
  } catch (err) {
    console.warn(err);
    if (name === 'canvas') throw err;
    note('WebGL2 is not available here, so this is the canvas renderer');
    return setRenderer('canvas');
  }
  resize();
  rendererBtn.textContent = `[R] ${renderer.name}`;
  try { localStorage.setItem('ascii-renderer', name); } catch {}
}

function resize() {
  renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
}

// Where a frame's picture is on screen right now, in CSS pixels (its grid tile while the grid is open).
function frameRect(f) {
  if (grid.isOpen) return grid.rectOf(f);
  const m = renderer.metrics;
  const left = world.cam.x - innerWidth / m.cw / 2, top = world.cam.y - innerHeight / m.ch / 2;
  return { x: (f.x + 1 - left) * m.cw, y: (f.y + 1 - top) * m.ch, w: f.cols * m.cw, h: f.rows * m.ch };
}

let lastFocus;
function updateCaption() {
  const fol = following && live && live.peers.get(following.id);
  if (fol) {
    const key = `follow:${fol.name}`;
    if (lastFocus === key) return;
    lastFocus = key;
    captionEl.replaceChildren(`following ${fol.name || 'someone'} · esc to stop`);
    captionEl.classList.add('on');
    return;
  }
  const f = viewer.isOpen || grid.isOpen ? null : world.focus || (world.atKiosk && 'kiosk');
  if (f === lastFocus) return;
  lastFocus = f;
  if (f) {
    captionEl.replaceChildren(f === 'kiosk' ? 'information · every photo, by colour' : captionText(f.photo));
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = '[E] open';
    captionEl.append(k);
    if (f !== 'kiosk') {
      const h = document.createElement('button');
      h.type = 'button';
      h.className = 'heart';
      h.textContent = '♥';
      h.title = 'Send a heart (H)';
      h.setAttribute('aria-label', 'Send a heart to this photo');
      h.addEventListener('click', () => sendHeart(world.focus));
      captionEl.append(h);
    }
  }
  captionEl.classList.toggle('on', !!f);
}

function openFrame(f, opts) {
  stopFollowing();
  if (viewer.isOpen) return;
  world.path = null;
  input.clear();
  viewer.open(f, opts);
}

function openGrid() {
  stopFollowing();
  if (viewer.isOpen || grid.isOpen) return;
  if (mapView.isOpen) mapView.toggle();
  world.path = null;
  input.clear();
  grid.open();
}

const inKiosk = (x, y) => { const k = map.kiosk; return x >= k.x && x < k.x + k.w && y >= k.y && y < k.y + k.h; };

function onTap(px, py) {
  if (viewer.isOpen || mapView.isOpen || grid.isOpen) return;
  const cell = renderer.cellAt(world, px, py);
  const peer = peerAtCell(cell.x, cell.y);
  if (peer) { following = { id: peer.id }; followAt = 0; return; }
  stopFollowing();
  if (inKiosk(cell.x, cell.y)) {
    walkTo(world, map.kiosk.stand.x, map.kiosk.stand.y, openGrid);
    return;
  }
  const f = frameAtCell(map, cell.x, cell.y);
  if (f) {
    walkTo(world, f.stand.x, f.stand.y, () => openFrame(f));
    return;
  }
  walkTo(world, cell.x, cell.y);
}

function onKey(e) {
  if (viewer.isOpen || grid.isOpen) return false;
  if (e.code === 'Escape' && following) { stopFollowing(); return true; }
  if (e.code === 'KeyM') { mapView.toggle(); return true; }
  if (e.code === 'KeyG') { openGrid(); return true; }
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') {
    if (world.focus) openFrame(world.focus);
    else if (world.atKiosk) openGrid();
    return true;
  }
  if (e.code === 'KeyR') {
    const names = Object.keys(RENDERERS);
    setRenderer(names[(names.indexOf(renderer.name) + 1) % names.length]);
    return true;
  }
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (digit) { sendEmote(EMOTES_ORDER[digit[1] - 1]); return true; }
  if (e.code === 'KeyH') { sendHeart(world.focus); return true; }
  if (e.code === 'KeyN') { document.getElementById('name-btn').click(); return true; }
  return false;
}

// Stand in front of a frame, camera already there.
function standAt(f) {
  teleport(world, f.stand.x + 0.5, f.stand.y + 0.5);
}

function currentRoomId() {
  const r = roomAt(map, world.player.x, world.player.y);
  return r >= 0 ? map.rooms[r].id : 'lobby';
}

function applyRoute(route) {
  if (!route) return;
  if (route.kind === 'all') {
    openGrid();
  } else if (route.kind === 'photo') {
    const f = map.frames.find((fr) => fr.id === route.id);
    if (!f) { note('photo not found'); replaceHash(''); return; }
    if (viewer.isOpen) return;
    standAt(f);
    openFrame(f, { instant: true });
  } else if (route.kind === 'room') {
    const room = map.rooms.find((r) => r.id === route.id);
    if (!room) { note('room not found'); replaceHash(''); return; }
    if (room.entry) teleport(world, room.entry.x + 0.5, room.entry.y + 0.5);
    else teleport(world, map.spawn.x, map.spawn.y);
  } else {
    note('page not found');
    replaceHash('');
  }
}

let last = performance.now();
const stats = { frames: 0, times: [] };
const NO_INPUT = { x: 0, y: 0, run: false };
function loop(now) {
  // Real per-frame dt, capped so a background tab doesn't teleport you on return.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  step(world, dt, viewer.isOpen || mapView.isOpen || grid.isOpen ? NO_INPUT : input.state());
  world.people = [];
  const att = map.kiosk.attendant;
  world.people.push({ x: att.x + 0.5, y: att.y + 0.5, glyph: '☺', color: [240, 204, 140] });
  // The attendant looks up when you come to the desk.
  if (world.atKiosk) world.people.push({ x: att.x + 1.5, y: att.y + 0.5, glyph: '!', color: [240, 204, 140] });
  for (const v of world.visitors) {
    world.people.push({ x: v.x, y: v.y, glyph: v.glyph, color: v.color });
    if (v.looking && v.wait > 0) world.people.push({ x: v.x, y: v.y - 1, glyph: '·', color: v.color });
  }
  world.entities = [];
  world.others = [];
  if (live) {
    const now = performance.now();
    live.tick(world.player, world.player.moving);
    const list = live.peers.list(now);
    world.others = list.filter((p) => p.alpha === 1);
    if (following) {
      const input0 = input.state();
      const target = list.find((p) => p.id === following.id && p.alpha === 1);
      if (!target || input0.x || input0.y) stopFollowing();
      else if (now - followAt > 500) {
        followAt = now;
        const c = followCell(map, target, (x, y) => isWalkable(map, x, y));
        if (c) walkTo(world, c.x, c.y);
      }
    }
    world.entities.push(...peerEntities(list, { reducedMotion }), ...heartEntities(live.peers.hearts(now), map.frames, { reducedMotion }));
  }
  world.entities.push(...echo.entities(world.player, map.frames, performance.now(), { reducedMotion }));
  world.entities.push({ x: world.player.x, y: world.player.y, glyph: '@', color: C.player });
  if (renderer.lost) {
    note('WebGL context lost, switched to the canvas renderer');
    setRenderer('canvas');
  }
  renderer.draw(world);
  viewer.sync();
  mapView.sync(world.player, roomAt(map, world.player.x, world.player.y), world.others);
  updateCaption();
  stats.frames++;
  stats.times.push(dt);
  if (stats.times.length > 600) stats.times.shift();
  if (debug && stats.frames % 10 === 0) {
    const t = stats.times.slice(-60);
    const avg = t.reduce((a, b) => a + b, 0) / t.length;
    const m = renderer.metrics;
    debugEl.textContent = `${(1 / avg).toFixed(0)} fps  ${(avg * 1000).toFixed(1)} ms\n${renderer.name}  ${Math.round(innerWidth / m.cw)}×${Math.round(innerHeight / m.ch)} cells\n@ ${Math.floor(world.player.x)},${Math.floor(world.player.y)}  ${currentRoomId()}` +
      `\nnet: ${live ? `${live.state} #${live.net.instance} · ${live.peers.count()} peers · ${live.net.ping ?? '–'} ms` : 'off'}`;
  }
  requestAnimationFrame(loop);
}

let live = null;
let following = null, followAt = 0;
function stopFollowing() { if (following) { following = null; lastFocus = undefined; } }
function peerAtCell(cx, cy) {
  if (!live) return null;
  return live.peers.list(performance.now()).find((p) => p.alpha === 1 && Math.abs(p.x - (cx + 0.5)) <= 1 && Math.abs(p.y - (cy + 0.5)) <= 1) || null;
}
const echo = localEcho();
function sendEmote(kind) {
  if (!echo.emote(kind, performance.now())) return;
  if (live) live.emote(kind);
}
function sendHeart(f) {
  if (!f || !echo.heart(f.id, performance.now())) return;
  if (live) live.heart(f.id);
}

async function boot() {
  let data;
  try {
    data = await loadData();
  } catch (err) {
    fatal(err);
    return;
  }
  map = buildLayout(data, SITE);
  world = createWorld(map, { reducedMotion });
  world.lighting = createLighting(map);
  input = createInput(stage, { onTap, onKey });
  grid = createGrid(map, {
    onPick: (f) => viewer.open(f, { instant: true, plain: true }),
    onOpen: () => replaceHash(ALL_HASH),
    onClose: () => { replaceHash(roomHash(currentRoomId())); stage.focus({ preventScroll: true }); },
  });
  viewer = createViewer({
    getRect: frameRect,
    order: map.frames,
    byId: data.byId,
    reducedMotion,
    setCamTarget: (t, snap) => { world.camTarget = t && { ...t, snap: !!snap }; },
    onShow: (f) => replaceHash(photoHash(f.id)),
    onNavigate: (f) => {
      if (grid.isOpen) grid.reveal(f); // the grid keeps you where you were; closing shrinks back onto the tile
      else standAt(f);
      replaceHash(photoHash(f.id));
    },
    onClose: (f) => {
      if (grid.isOpen) { replaceHash(ALL_HASH); grid.focus(f); return; }
      replaceHash(roomHash(currentRoomId()));
      stage.focus({ preventScroll: true });
    },
  });
  let pick = new URLSearchParams(location.search).get('r');
  if (!RENDERERS[pick]) { try { pick = localStorage.getItem('ascii-renderer'); } catch {} }
  setRenderer(RENDERERS[pick] ? pick : 'gl'); // WebGL by default; falls back to canvas if unavailable
  addEventListener('resize', resize);
  rendererBtn.addEventListener('click', () => onKey({ code: 'KeyR' }));
  mapView = createMap(map, {
    onOpen: () => { input.clear(); stopFollowing(); },
    onClose: () => stage.focus({ preventScroll: true }),
    onGo: (room) => {
      const to = room.entry || { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
      if (!walkTo(world, to.x, to.y, null, { quick: true })) note(`can't find a way to ${room.name}`);
    },
  });
  document.getElementById('map-btn').addEventListener('click', () => mapView.toggle());
  const emoteBtn = document.getElementById('emote-btn'), emoteBar = document.getElementById('emote-bar');
  emoteBtn.hidden = false;
  EMOTES_ORDER.forEach((kind, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = EMOTE_GLYPH[kind];
    b.title = `${kind} (${i + 1})`;
    b.setAttribute('aria-label', kind);
    b.addEventListener('click', () => { sendEmote(kind); emoteBar.hidden = true; emoteBtn.setAttribute('aria-expanded', 'false'); });
    emoteBar.append(b);
  });
  emoteBtn.addEventListener('click', () => { emoteBar.hidden = !emoteBar.hidden; emoteBtn.setAttribute('aria-expanded', String(!emoteBar.hidden)); });
  const nameForm = document.getElementById('name-form'), nameInput = document.getElementById('name-input'), nameMsg = document.getElementById('name-msg');
  const openName = () => {
    try { nameInput.value = localStorage.getItem('faiz-live-name') || ''; } catch {}
    nameMsg.textContent = '';
    nameForm.hidden = false;
    nameInput.focus();
    nameInput.select(); // typing replaces the old name
  };
  const closeName = () => { nameForm.hidden = true; stage.focus({ preventScroll: true }); };
  document.getElementById('name-btn').addEventListener('click', openName);
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = cleanName(nameInput.value);
    if (n === null) { nameMsg.textContent = 'try another name'; return; }
    try { localStorage.setItem('faiz-live-name', n); } catch {}
    if (live) live.setName(n);
    closeName();
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeName(); } });
  const hereEl = document.getElementById('hud-here');
  live = createLive({
    version: data.generated,
    getName: () => { try { return localStorage.getItem('faiz-live-name') || ''; } catch { return ''; } },
    onCount: (n) => { hereEl.hidden = !n; hereEl.textContent = `${n} here`; },
    onAnnounce: (kind, m) => {
      // Only people in your room are announced, to keep screen readers quiet.
      if (roomAt(map, m.x, m.y) !== roomAt(map, world.player.x, world.player.y)) return;
      captionEl.setAttribute('aria-live', 'polite');
      note(`${m.name || 'someone'} ${kind === 'join' ? 'joined' : 'left'}`, 2000);
    },
    onRejected: () => note('try another name'),
  });
  if (debug) debugEl.hidden = false;

  // A hidden list of every photo, so screen readers have a way in.
  const nav = document.getElementById('photo-links');
  const all = document.createElement('a');
  all.href = ALL_HASH;
  all.textContent = `All ${map.frames.length} photos, by colour`;
  nav.append(all);
  map.frames.forEach((f, i) => {
    const a = document.createElement('a');
    a.href = photoHash(f.id);
    a.textContent = `${describe(f.photo)}, ${map.rooms[f.roomIndex].name} (${i + 1} of ${map.frames.length})`;
    nav.append(a);
  });

  applyRoute(parseRoute(location.hash));
  addEventListener('hashchange', () => applyRoute(parseRoute(location.hash)));

  // Test hook for the e2e scripts.
  window.__ascii = { map, world, stats, viewer, teleport: (x, y) => teleport(world, x, y), walkTo: (x, y) => walkTo(world, x, y),
    open: (id) => openFrame(map.frames.find((f) => f.id === id)), grid, tapCell: (x, y) => { const m = renderer.metrics; onTap((x + 0.5 - world.cam.x) * m.cw + innerWidth / 2, (y + 0.5 - world.cam.y) * m.ch + innerHeight / 2); }, setRenderer, live: () => live, get renderer() { return renderer.name; } };
  requestAnimationFrame((t) => { last = t; loop(t); });
}

boot();
