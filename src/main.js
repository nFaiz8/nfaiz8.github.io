import { SITE } from './config.js';
import { loadData, captionText, describe } from './data.js';
import { buildLayout } from './layout.js';
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
  const f = viewer.isOpen || grid.isOpen ? null : world.focus || (world.atKiosk && 'kiosk');
  if (f === lastFocus) return;
  lastFocus = f;
  if (f) {
    captionEl.replaceChildren(f === 'kiosk' ? 'every photo, by colour' : captionText(f.photo));
    const k = document.createElement('span');
    k.className = 'key';
    k.textContent = '[E] open';
    captionEl.append(k);
  }
  captionEl.classList.toggle('on', !!f);
}

function openFrame(f, opts) {
  if (viewer.isOpen) return;
  world.path = null;
  input.clear();
  viewer.open(f, opts);
}

function openGrid() {
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
  for (const v of world.visitors) {
    world.people.push({ x: v.x, y: v.y, glyph: v.glyph, color: v.color });
    if (v.looking && v.wait > 0) world.people.push({ x: v.x, y: v.y - 1, glyph: '·', color: v.color });
  }
  world.entities = [{ x: world.player.x, y: world.player.y, glyph: '@', color: C.player }];
  if (renderer.lost) {
    note('WebGL context lost, switched to the canvas renderer');
    setRenderer('canvas');
  }
  renderer.draw(world);
  viewer.sync();
  mapView.sync(world.player, roomAt(map, world.player.x, world.player.y));
  updateCaption();
  stats.frames++;
  stats.times.push(dt);
  if (stats.times.length > 600) stats.times.shift();
  if (debug && stats.frames % 10 === 0) {
    const t = stats.times.slice(-60);
    const avg = t.reduce((a, b) => a + b, 0) / t.length;
    const m = renderer.metrics;
    debugEl.textContent = `${(1 / avg).toFixed(0)} fps  ${(avg * 1000).toFixed(1)} ms\n${renderer.name}  ${Math.round(innerWidth / m.cw)}×${Math.round(innerHeight / m.ch)} cells\n@ ${Math.floor(world.player.x)},${Math.floor(world.player.y)}  ${currentRoomId()}`;
  }
  requestAnimationFrame(loop);
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
    onOpen: () => input.clear(),
    onClose: () => stage.focus({ preventScroll: true }),
    onGo: (room) => {
      const to = room.entry || { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
      if (!walkTo(world, to.x, to.y, null, { quick: true })) note(`can't find a way to ${room.name}`);
    },
  });
  document.getElementById('map-btn').addEventListener('click', () => mapView.toggle());
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
    open: (id) => openFrame(map.frames.find((f) => f.id === id)), grid, tapCell: (x, y) => { const m = renderer.metrics; onTap((x + 0.5 - world.cam.x) * m.cw + innerWidth / 2, (y + 0.5 - world.cam.y) * m.ch + innerHeight / 2); }, setRenderer, get renderer() { return renderer.name; } };
  requestAnimationFrame((t) => { last = t; loop(t); });
}

boot();
