import { SITE, ARENA } from './config.js';
import levelText from './arena.txt?raw';
import { parseLevel } from './arena.js';
import { createLive, peerEntities, heartEntities, localEcho, peerColor } from './live.js';
import { EMOTES_ORDER, EMOTE_GLYPH, followCell } from './peers.js';
import { cleanName, cleanText } from '../server/rules.js';
import { loadData, captionText, describe } from './data.js';
import { buildLayout, isWalkable } from './layout.js';
import { createWorld, step, walkTo, frameAtCell, teleport, roomAt, enterSide, exitSide, inArena } from './world.js';
import { createInput } from './input.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createGlRenderer } from './render/gl.js';
import { C } from './render/palette.js';
import { figureGlyphs } from './render/figures.js';
import { createMotionMemory } from './stick.js';
import { createLighting, createArenaLighting } from './light.js';
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
const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
const padEl = document.getElementById('pad');
let hintOn = false;
const debug = new URLSearchParams(location.search).has('debug');
const onLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// ?bots=30 (localhost only): that many local stickmen in the arena, cycling through every act.
const botCount = onLocalhost ? Math.min(100, Math.max(0, parseInt(new URLSearchParams(location.search).get('bots'), 10) || 0)) : 0;
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
    renderer.onLoad.add((f) => loadedIds.add(f.id));
  } catch (err) {
    console.warn(err);
    if (name === 'canvas') throw err;
    note('WebGL2 is not available here, so this is the canvas renderer');
    return setRenderer('canvas');
  }
  resize();
  const long = document.createElement('span');
  long.className = 'long';
  long.textContent = ` ${renderer.name}`;
  rendererBtn.replaceChildren('[R]', long);
  try { localStorage.setItem('ascii-renderer', name); } catch {}
}

function resize() {
  const m = renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
  if (world && m) world.view = { cols: innerWidth / m.cw, rows: innerHeight / m.ch };
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
    if (f !== 'kiosk' && live) {
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
  if (world.mode === 'side' || tilting) return; // in the arena you run and jump
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
  if (e.code === 'Space' && world.mode === 'side') return true; // jump (input.js holds it)
  if (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space') {
    if (world.focus) openFrame(world.focus, world.mode === 'side' ? { instant: true } : undefined);
    else if (world.atKiosk) openGrid();
    return true;
  }
  if (e.code === 'KeyR') {
    const names = Object.keys(RENDERERS);
    setRenderer(names[(names.indexOf(renderer.name) + 1) % names.length]);
    return true;
  }
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (live && digit) { sendEmote(EMOTES_ORDER[digit[1] - 1]); return true; }
  if (live && e.code === 'KeyH') { sendHeart(world.focus); return true; }
  if (live && e.code === 'KeyN') { document.getElementById('name-btn').click(); return true; }
  if (live && e.code === 'KeyT') { document.getElementById('chat-btn').click(); return true; }
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
const NO_INPUT = { x: 0, y: 0, run: false, jump: false, down: false };
function loop(now) {
  // Real per-frame dt, capped so a background tab doesn't teleport you on return.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  step(world, dt, viewer.isOpen || mapView.isOpen || grid.isOpen ? NO_INPUT : input.state());
  if (world.want) tilt();
  world.lighting = world.mode === 'side' ? lightingSide : lightingTop;
  if (world.mode !== lastMode) {
    lastMode = world.mode;
    if (world.mode === 'side' && touch && innerHeight > innerWidth) { note('turn your phone sideways for the arena ↻', 4000); hintOn = true; }
  }
  const showPad = touch && world.mode === 'side' && !viewer.isOpen && !grid.isOpen && !mapView.isOpen;
  if (padEl.hidden === showPad) {
    padEl.hidden = !showPad;
    document.body.classList.toggle('pad-on', showPad);
    if (!showPad) input.clear();
  }
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
  // In the arena's side view people are stick figures (world.bodies → world.figures); top-down they are @.
  const side = world.mode === 'side' && !!map.arena;
  const bodies = [];
  if (live) {
    const now = performance.now();
    live.tick(world.player);
    const list = live.peers.list(now);
    world.others = list.filter((p) => p.alpha === 1);
    // People in the arena are drawn only in its side view, and the side view shows only them.
    const inside = (p) => inArena(map, p.x, p.y);
    const shown = list.filter((p) => inside(p) === side);
    if (following) {
      const input0 = input.state();
      const target = list.find((p) => p.id === following.id && p.alpha === 1);
      if (!target || input0.x || input0.y || world.mode === 'side' || inside(target)) stopFollowing();
      else if (now - followAt > 500) {
        followAt = now;
        const c = followCell(map, target, (x, y) => isWalkable(map, x, y));
        if (c) walkTo(world, c.x, c.y);
      }
    }
    const posOf = (id) => list.find((p) => p.id === id) || null;
    if (side) for (const p of shown) bodies.push(peerBody(p));
    else world.entities.push(...peerEntities(shown, { reducedMotion, muted }));
    world.entities.push(...heartEntities(live.peers.hearts(now), map.frames, { reducedMotion, posOf }));
  }
  if (side) {
    const now = performance.now();
    for (let i = 0; i < botCount; i++) bodies.push(botBody(i, now / 1000));
    bodies.push(myBody(now));
    mine.hearts = mine.hearts.filter((h) => now - h.at < MY_HEART_MS);
    const hearts = mine.hearts.map((h) => ({ f: h.f, id: 'me', age: (now - h.at) / MY_HEART_MS }));
    world.entities.push(...heartEntities(hearts, map.frames, { reducedMotion, posOf: () => world.player }));
    const m = renderer.metrics, cols = innerWidth / m.cw, rows = innerHeight / m.ch;
    world.figures = figureGlyphs(bodies, { t: now / 1000, reducedMotion, phone: touch, memory,
      view: { left: world.cam.x - cols / 2, top: world.cam.y - rows / 2, cols, rows }, ceiling: map.arena.y + 1 });
  } else {
    world.entities.push(...echo.entities(world.player, map.frames, performance.now(), { reducedMotion }));
    world.entities.push({ x: world.player.x, y: world.player.y, glyph: '@', color: C.player });
    world.figures = [];
  }
  world.bodies = bodies;
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
let lightingTop = null, lightingSide = null, tilting = false, lastMode = 'top';
const loadedIds = new Set();
let following = null, followAt = 0;
const muted = new Set(); // ids whose chat you've hidden, for this visit
function stopFollowing() { if (following) { following = null; lastFocus = undefined; } }

// Through the arena door the view tilts away, switches between top-down and side-on, and tilts back in.
// Input waits for it. Reduce Motion: an instant cut.
async function tilt() {
  if (tilting || !world.want) return;
  tilting = true;
  world.frozen = true;
  const to = world.want, s = to === 'side' ? 1 : -1;
  const pose = (deg, o) => ({ transform: `perspective(900px) rotateX(${deg}deg)`, opacity: o });
  if (!reducedMotion) {
    const out = stage.animate([pose(0, 1), pose(55 * s, 0.15)], { duration: 300, easing: 'ease-in', fill: 'forwards' });
    await out.finished;
    (to === 'side' ? enterSide : exitSide)(world);
    const back = stage.animate([pose(-55 * s, 0.15), pose(0, 1)], { duration: 300, easing: 'ease-out' });
    out.cancel();
    await back.finished;
  } else {
    (to === 'side' ? enterSide : exitSide)(world);
  }
  world.frozen = false;
  tilting = false;
}
function peerAtCell(cx, cy) {
  if (!live) return null;
  return live.peers.list(performance.now()).find((p) => p.alpha === 1 && Math.abs(p.x - (cx + 0.5)) <= 1 && Math.abs(p.y - (cy + 0.5)) <= 1) || null;
}
const echo = localEcho();
// What I said, emoted and hearted lately, for my own label stack in the side view (top-down, the echo
// draws them). The times are createPeers' defaults, so I see them as long as others do.
const MY_SAY_MS = 5000, MY_EMOTE_MS = 2500, MY_HEART_MS = 2000;
const mine = { say: null, sayAt: 0, emote: null, emoteAt: 0, hearts: [] };
function sendEmote(kind) {
  const now = performance.now();
  if (!echo.emote(kind, now)) return;
  mine.emote = EMOTE_GLYPH[kind] || null;
  mine.emoteAt = now;
  if (live) live.emote(kind);
}
function sendHeart(f) {
  const now = performance.now();
  if (!f || !echo.heart(f.id, now)) return;
  mine.hearts.push({ f: f.id, at: now });
  if (live) live.heart(f.id);
}

// The side view's bodies (stickman spec §5, §6). Each has a state for stickPose; the motion memory fills in
// landT and spawnT. __ascii.pose (localhost) pins fields of my state, landT and spawnT included.
let posePin = null;
const motion = createMotionMemory();
const memory = {
  fill(id, s, t) {
    motion.fill(id, s, t);
    if (id === 'me' && posePin) {
      if ('landT' in posePin) s.landT = posePin.landT;
      if ('spawnT' in posePin) s.spawnT = posePin.spawnT;
    }
    return s;
  },
};
function myBody(now) {
  const p = world.player;
  const state = { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, ground: !!p.onGround, act: 'idle', gun: 'deagle', ...posePin };
  const emoting = mine.emote && now - mine.emoteAt < MY_EMOTE_MS;
  return { id: 'me', me: true, state, color: C.player, name: '', alpha: 1,
    say: mine.say && now - mine.sayAt < MY_SAY_MS ? mine.say : null,
    emote: emoting ? mine.emote : null, emoteAge: emoting ? (now - mine.emoteAt) / MY_EMOTE_MS : 0 };
}
// Someone inside, from their positions alone until PvP sends their state.
function peerBody(p) {
  return { id: p.id, state: { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, ground: p.ground, act: 'idle' },
    color: peerColor(p.id), name: p.name, say: p.say && !muted.has(p.id) ? p.say : null,
    emote: p.emote, emoteAge: p.emoteAge, alpha: p.alpha };
}
// ?bots: one local stickman per slot along the floor, each spending 2.4 s on every act in turn.
const BOT_ACTS = ['idle', 'run', 'jump', 'shoot', 'punch', 'kick', 'hurt', 'roll', 'dead'];
const BOT_GUNS = ['deagle', 'rifle', 'sniper'];
function botBody(i, t) {
  const a = map.arena, k = t + i * 0.37, T = 2.4;
  const act = BOT_ACTS[(Math.floor(k / T) + i) % BOT_ACTS.length], u = k % T;
  const x0 = a.x + 5 + ((i + 0.5) * (a.cols - 8)) / botCount, y0 = a.floorY - 1.5;
  const s = { x: x0, y: y0, vx: 0, vy: 0, facing: i % 2 ? -1 : 1, ground: true, act, actT: u, gun: BOT_GUNS[i % 3], aim: 0 };
  if (act === 'run') {
    const d = (u * 30) % 16, out = d < 8;
    s.act = 'idle'; s.x = x0 - 4 + (out ? d : 16 - d); s.vx = out ? 30 : -30; s.facing = out ? 1 : -1;
  } else if (act === 'jump') {
    const j = u % 0.6;
    s.act = 'idle'; s.ground = false; s.vy = -40 + 133 * j; s.y = y0 - (40 * j - 66.5 * j * j);
  } else if (act === 'shoot') {
    s.actT = u % 0.3; s.aim = Math.sin(k * 1.3) * 1.4;
  } else if (act === 'punch' || act === 'hurt') s.actT = u % 0.5;
  else if (act === 'kick' || act === 'roll') s.actT = u % 0.6;
  return { id: `bot${i + 1}`, state: s, color: peerColor(`bot${i + 1}`), name: `bot${i + 1}`, alpha: 1,
    say: i % 3 === 0 ? 'hello there' : null, emote: i % 4 === 1 ? '★' : null, emoteAge: (u % 2.5) / 2.5 };
}

async function boot() {
  let data;
  try {
    data = await loadData(undefined, ARENA.enabled ? [ARENA.photo] : []);
  } catch (err) {
    fatal(err);
    return;
  }
  const arenaPhoto = ARENA.enabled ? data.byId.get(ARENA.photo) || null : null;
  if (ARENA.enabled && !arenaPhoto) console.warn(`ARENA.photo "${ARENA.photo}" isn't in photos.json: the arena has a plain dark backdrop`);
  map = buildLayout(data, SITE, { arena: ARENA.enabled ? { photo: arenaPhoto, level: parseLevel(levelText) } : null });
  world = createWorld(map, { reducedMotion });
  lightingTop = createLighting(map);
  lightingSide = map.arena ? createArenaLighting(map) : null;
  world.lighting = lightingTop;
  input = createInput(stage, { onTap, onKey });
  for (const b of padEl.querySelectorAll('button')) {
    const set = (on) => { input.press(b.dataset.code, on); b.classList.toggle('on', on); };
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); set(true); });
    for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(t, () => set(false));
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  addEventListener('pointerdown', () => { if (hintOn) { hintOn = false; noteEl.classList.remove('on'); } }, { capture: true });
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
    extra: {
      label: 'arena →', key: 'arena', aria: 'Go to the arena',
      show: (f) => !!f.backdrop && world.mode !== 'side',
      onClick: async () => {
        await viewer.close();
        if (grid.isOpen) grid.close();
        const e = map.arena.entry;
        walkTo(world, e.x, e.y, null, { quick: true });
      },
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
      if (room.arena && world.mode === 'side') return; // already here
      const to = room.entry || { x: Math.floor(map.spawn.x), y: Math.floor(map.spawn.y) };
      if (!walkTo(world, to.x, to.y, null, { quick: true })) note(`can't find a way to ${room.name}`);
    },
  });
  document.getElementById('map-btn').addEventListener('click', () => mapView.toggle());
  const emoteBtn = document.getElementById('emote-btn'), emoteBar = document.getElementById('emote-bar');
  const nameBtn = document.getElementById('name-btn');
  // The emote bar and name form open just under the HUD (which is taller on some screens), one at a time.
  const hudEl = document.querySelector('.hud');
  const popover = (el, open) => {
    el.hidden = !open;
    if (open) el.style.top = `${Math.round(hudEl.getBoundingClientRect().bottom) + 6}px`;
    (el === emoteBar ? emoteBtn : nameBtn).setAttribute('aria-expanded', String(open));
  };
  EMOTES_ORDER.forEach((kind, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = EMOTE_GLYPH[kind];
    b.title = `${kind} (${i + 1})`;
    b.setAttribute('aria-label', kind);
    b.addEventListener('click', () => { sendEmote(kind); popover(emoteBar, false); });
    emoteBar.append(b);
  });
  emoteBtn.addEventListener('click', () => { const open = emoteBar.hidden; if (open) closeName(false); popover(emoteBar, open); });
  const nameForm = document.getElementById('name-form'), nameInput = document.getElementById('name-input'), nameMsg = document.getElementById('name-msg');
  const openName = () => {
    try { nameInput.value = localStorage.getItem('faiz-live-name') || ''; } catch {}
    nameMsg.textContent = '';
    popover(emoteBar, false);
    popover(nameForm, true);
    nameInput.focus();
    nameInput.select(); // typing replaces the old name
  };
  const closeName = (refocus = true) => {
    if (nameForm.hidden) return;
    popover(nameForm, false);
    if (refocus) stage.focus({ preventScroll: true });
  };
  nameBtn.addEventListener('click', () => (nameForm.hidden ? openName() : closeName()));
  nameForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const n = cleanName(nameInput.value);
    if (n === null) { nameMsg.textContent = 'try another name'; return; }
    try { localStorage.setItem('faiz-live-name', n); } catch {}
    if (live) live.setName(n);
    closeName();
  });
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeName(); } });
  // Chat: a line at the bottom to type into, and a short log of the last few lines (click a name to mute).
  const chatBtn = document.getElementById('chat-btn'), chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input'), chatMsg = document.getElementById('chat-msg'), chatLog = document.getElementById('chat-log');
  let idleTimer = 0;
  const addLog = (id, name, text) => {
    const line = document.createElement('div');
    line.dataset.id = id || '';
    const who = document.createElement(id ? 'button' : 'span');
    who.className = 'chat-who';
    who.textContent = id ? name || 'someone' : 'you';
    if (id) {
      who.type = 'button';
      who.title = 'Hide their messages';
      who.addEventListener('click', () => {
        muted.add(id);
        for (const l of [...chatLog.children]) if (l.dataset.id === id) l.remove();
        note(`muted ${name || 'someone'}`);
      });
    }
    line.append(who, text);
    chatLog.append(line);
    while (chatLog.children.length > 6) chatLog.firstChild.remove();
    chatLog.classList.remove('idle');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => chatLog.classList.add('idle'), 8000);
  };
  const closeChat = () => { if (chatForm.hidden) return; chatForm.hidden = true; stage.focus({ preventScroll: true }); };
  chatBtn.addEventListener('click', () => {
    if (!chatForm.hidden) return closeChat();
    chatMsg.textContent = '';
    chatForm.hidden = false;
    chatInput.focus();
  });
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cleanText(chatInput.value);
    if (text === null) { chatMsg.textContent = chatInput.value.trim() ? 'try different words' : ''; return; }
    const at = performance.now();
    if (!echo.say(text, at)) { chatMsg.textContent = 'one line every 2 s'; return; }
    mine.say = text;
    mine.sayAt = at;
    if (live) live.chat(text);
    addLog(null, '', text);
    chatInput.value = '';
    closeChat();
  });
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeChat(); } });
  const hereEl = document.getElementById('hud-here');
  live = createLive({
    version: data.generated,
    getPos: () => world.player,
    getName: () => { try { return localStorage.getItem('faiz-live-name') || ''; } catch { return ''; } },
    onCount: (n) => { hereEl.hidden = !n; hereEl.textContent = `${n} here`; },
    onAnnounce: (kind, m) => {
      // Only people in your room are announced, to keep screen readers quiet.
      if (roomAt(map, m.x, m.y) !== roomAt(map, world.player.x, world.player.y)) return;
      captionEl.setAttribute('aria-live', 'polite');
      note(`${m.name || 'someone'} ${kind === 'join' ? 'joined' : 'left'}`, 2000);
    },
    onRejected: () => note('try another name'),
    onChat: ({ id, name, text }) => { if (!muted.has(id)) addLog(id, name, text); },
    onChatRejected: () => note('try different words'),
  });
  if (live) { emoteBtn.hidden = false; nameBtn.hidden = false; chatBtn.hidden = false; }
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
  window.__ascii = { map, world, stats, viewer, mode: () => world.mode, tilting: () => tilting, loaded: (id) => loadedIds.has(id), teleport: (x, y) => teleport(world, x, y), walkTo: (x, y) => walkTo(world, x, y),
    open: (id) => openFrame(map.frames.find((f) => f.id === id)), grid, tapCell: (x, y) => { const m = renderer.metrics; onTap((x + 0.5 - world.cam.x) * m.cw + innerWidth / 2, (y + 0.5 - world.cam.y) * m.ch + innerHeight / 2); }, setRenderer, live: () => live, metrics: () => renderer.metrics, get renderer() { return renderer.name; } };
  // Pins fields of my side-view state (act, actT, aim, x, y, landT, spawnT…) until called with null.
  if (onLocalhost) window.__ascii.pose = (state) => { posePin = state ? { ...state } : null; };
  requestAnimationFrame((t) => { last = t; loop(t); });
}

boot();
