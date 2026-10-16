import { SITE, ARENA } from './config.js';
import trainText from './arena.txt?raw';
import gorgeText from './gorge.txt?raw';
import { sideZoom, climbLook } from './arena.js';
import { buildTrain, frameAt as trainFrameAt, paintWindow as trainPaint, flashGlows } from './train.js';
import { buildGorge, frameAt as gorgeFrameAt, paintWindow as gorgePaint } from './gorge/look.js';
import { levelHash, parseMap, mapName, MAP_NAMES } from './level.js';
import { FIGHT_VERSION } from './fight.js';
import { createPvp } from './pvp.js';
import { createFightHud } from './fighthud.js';
import { createKeyScreen } from './keyscreen.js';
import { loadKeys, saveKeys, translate, keyOf, keyName } from './keys.js';
import { createLive, peerEntities, heartEntities, localEcho, peerColor, fetchArenaMap } from './live.js';
import { EMOTES_ORDER, EMOTE_GLYPH, followCell } from './peers.js';
import { cleanName, cleanText, hasSlur, LIMITS, adminOk } from '../server/rules.js';
import { loadData, captionText, describe } from './data.js';
import { buildLayout, isWalkable } from './layout.js';
import { createWorld, step, walkTo, frameAtCell, teleport, roomAt, enterSide, exitSide, inArena, snapCamera } from './world.js';
import { createInput } from './input.js';
import { createCanvasRenderer } from './render/canvas.js';
import { createGlRenderer } from './render/gl.js';
import { createMuseumRenderer } from './render/museum.js';
import { C } from './render/palette.js';
import { figureGlyphs } from './render/figures.js';
import { createMotionMemory } from './stick.js';
import { createLighting } from './light.js';
import { createViewer } from './viewer.js';
import { parseRoute, photoHash, roomHash, replaceHash, ALL_HASH, STATION_HASH } from './router.js';
import { createMap } from './map.js';
import { creditText } from './track-choice.js';
import { createShots } from './shots.js';
import { createGrid } from './grid.js';
import { createAdmin } from './admin.js';
import { isMuted, setMuted, onMuted } from './sound-pref.js';

const stage = document.getElementById('stage');
const captionEl = document.getElementById('caption');
const noteEl = document.getElementById('note');
const fightSr = document.getElementById('fight-sr');
const rendererBtn = document.getElementById('renderer-btn');
const shotsBtn = document.getElementById('shots-btn');
const keysBtn = document.getElementById('keys-btn');
const debugEl = document.getElementById('debug');
document.getElementById('hud-name').textContent = SITE.name;

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches;
const padEl = document.getElementById('pad');
let hintOn = false;
const PVP = ARENA.enabled && ARENA.pvp !== false;
const DUMMY_COLOR = [150, 150, 150];
const debug = new URLSearchParams(location.search).has('debug');
const onLocalhost = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
// ?bots=30 (localhost only): that many local stickmen in the arena, cycling through every act.
const botCount = onLocalhost ? Math.min(100, Math.max(0, parseInt(new URLSearchParams(location.search).get('bots'), 10) || 0)) : 0;
const RENDERERS = { museum: createMuseumRenderer, canvas: createCanvasRenderer, gl: createGlRenderer };
const RENDERER_KEY = 'ascii-renderer-2'; // new key: everyone starts in the museum look, whatever they picked before

let map, world, renderer, input, viewer, mapView, grid, pvp = null, fightHud = null;
// The arena's maps (gorge addendum): each level's text, and the decor drawn over it (train.js's interface).
const LEVEL_TEXT = { train: trainText, gorge: gorgeText };
const DECOR = {
  train: { build: buildTrain, frameAt: trainFrameAt, paint: trainPaint },
  gorge: { build: buildGorge, frameAt: gorgeFrameAt, paint: gorgePaint },
};
// The map up is the server's (an admin switches it for everyone): asked for before the page builds, and
// kept in this browser for when the server can't be asked. On localhost ?map=gorge (or train) picks it.
const MAP_KEY = 'arena-map', BACK_KEY = 'arena-back';
let arenaMap = 'train';
async function chooseMap() {
  const asked = new URLSearchParams(location.search).get('map');
  if (onLocalhost && asked) return mapName(asked);
  const server = await fetchArenaMap();
  try {
    if (server) localStorage.setItem(MAP_KEY, mapName(server));
    return mapName(server || localStorage.getItem(MAP_KEY));
  } catch { return mapName(server); }
}
// The server says another map is up (the welcome, or an admin just switched it): build that one, by
// reloading; whoever was in the arena is put back in it.
let switching = false;
let admin = { answer() {}, toggle() {}, open() {}, isOpen: false }; // the admin panel, once the page is built
function followMap(name) {
  if (switching || !MAP_NAMES.includes(name) || name === arenaMap) return;
  switching = true;
  try { localStorage.setItem(MAP_KEY, name); if (world && world.mode === 'side') sessionStorage.setItem(BACK_KEY, '1'); } catch {}
  note(`the arena is now the ${name}`, 3000);
  const url = new URL(location.href);
  url.searchParams.delete('map');
  // The same address (an arena link's #/room/arena, say) would only move to its hash: reload it instead.
  setTimeout(() => (url.href === location.href ? location.reload() : location.replace(url.href)), 1200);
}
const fightHashOf = (name) => `${levelHash(LEVEL_TEXT[name])}.${FIGHT_VERSION}`; // as the server's: the level and the wire version

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
  showR();
  try { localStorage.setItem(RENDERER_KEY, name); } catch {}
}

function resize() {
  renderer.resize(innerWidth, innerHeight, Math.min(2, devicePixelRatio || 1));
  syncView();
  padTop = null;
}

// The cells on screen, from the renderer's metrics of the moment (the side view's zoom, or the gallery's).
function syncView() {
  const m = renderer.metrics;
  if (world && m) world.view = { cols: innerWidth / m.cw, rows: innerHeight / m.ch };
}

// The train's look (train level addendum §1): 'line' (box drawing and colour) on every visit; in the arena
// R, and its button, switch it to 'ascii' (7-bit) and back. Not remembered: line stays the default.
const LOOKS = ['line', 'ascii'];
let look = 'line';
const inArenaView = () => !!world && world.mode === 'side' && !!map.arena;
// The [R] button: in the arena it names the look it switches to; elsewhere the renderer in use.
function showR() {
  const long = document.createElement('span');
  long.className = 'long';
  if (inArenaView()) {
    const other = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length];
    long.textContent = ` ${other}`;
    rendererBtn.title = `Switch the ${arenaMap} to ${other} (R)`;
  } else {
    long.textContent = ` ${renderer.name}`;
    rendererBtn.title = 'Switch renderer (R)';
  }
  rendererBtn.setAttribute('aria-label', rendererBtn.title);
  rendererBtn.replaceChildren('[R]', long);
}

// The side view's zoom by the gun in hand (train level addendum §2), and on touch how far the figure keeps
// clear of the pad: its top above the screen's bottom, and how far its two clusters reach in from the
// screen's sides, in CSS pixels (measured when the pad shows or the screen changes).
let zoom = null, padTop = null, padLeft = 0, padRight = 0;
function sideView(t) {
  if (world.mode !== 'side' || !map.arena) {
    zoom = null;
    renderer.setView(null);
    world.inset = null;
    return;
  }
  // The gun in hand; while popped, keep the last zoom; not fighting, the plain side view. The sniper held
  // crouched or prone is the scope (crouch addendum §3).
  let gun = pvp && pvp.entered ? (pvp.me.alive ? pvp.me.gun : undefined) : null;
  if (gun === 'sniper' && world.player.low) gun = 'scope';
  const first = !zoom;
  zoom = sideZoom(zoom, gun, t / 1000, { reducedMotion });
  renderer.setView({ rows: zoom.rows, settled: zoom.settled });
  // Just in: the camera snapped for the gallery's view size; snap it again for the side view's.
  if (first) { syncView(); snapCamera(world); }
  if (!padEl.hidden) {
    if (padTop === null) {
      padTop = innerHeight; padLeft = 0; padRight = 0;
      for (const b of padEl.querySelectorAll('button')) {
        if (b.hidden) continue;
        const r = b.getBoundingClientRect();
        padTop = Math.min(padTop, r.top);
        if (r.left + r.width / 2 < innerWidth / 2) padLeft = Math.max(padLeft, r.right);
        else padRight = Math.max(padRight, innerWidth - r.left);
      }
    }
    // The feet clear the pad's top only over a cluster (the figure's 2 cells of reach either side).
    const m = renderer.metrics;
    world.inset = { bottom: (innerHeight - padTop) / m.ch + 0.5, side: 4, left: padLeft / m.cw + 2, right: padRight / m.cw + 2 };
  } else world.inset = null;
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
  if (stationState !== 'off') return;
  if (viewer.isOpen || mapView.isOpen || grid.isOpen || shots?.isOpen) return;
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

// F: fullscreen and back, where the browser has it (iPhone Safari doesn't: there F does nothing).
function toggleFullscreen() {
  const d = document, el = d.documentElement;
  const on = d.fullscreenElement || d.webkitFullscreenElement;
  const go = on ? d.exitFullscreen || d.webkitExitFullscreen : el.requestFullscreen || el.webkitRequestFullscreen;
  if (!go) return;
  try { Promise.resolve(go.call(on ? d : el)).catch(() => {}); } catch {}
}

function onKey(e) {
  if (stationState === 'in') return stationKey(e);
  if (stationState !== 'off') return false;
  if (viewer.isOpen || grid.isOpen) return false;
  if (e.code === 'Escape' && following) { stopFollowing(); return true; }
  if (e.code === 'KeyM') { mapView.toggle(); return true; }
  if (e.code === 'KeyI' && shots && !shotsBtn.hidden) { shots.toggle(); return true; }
  if (e.code === 'Slash' && keyScreen && world.mode === 'side') { keyScreen.toggle(); return true; }
  if (e.code === 'Backquote' && ARENA.enabled) { admin.toggle(arenaMap); return true; }
  if (e.code === 'KeyF') { toggleFullscreen(); return true; }
  if (e.code === 'KeyV' && !e.repeat) { setMuted(!isMuted()); return true; } // sound (M is the map)
  if (e.code === 'Space' && world.mode === 'side') return true; // jump (input.js holds it)
  if (e.code === 'KeyE') { // only E opens (not Enter or Space)
    if (world.focus) openFrame(world.focus, world.mode === 'side' ? { instant: true } : undefined);
    else if (world.atKiosk) openGrid();
    return true;
  }
  if (e.code === 'KeyR' && inArenaView()) {
    look = LOOKS[(LOOKS.indexOf(look) + 1) % LOOKS.length];
    showR();
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
  } else if (route.kind === 'station') {
    if (stationState === 'off') goDown({ instant: true });
  } else {
    note('page not found');
    replaceHash('');
  }
}

let last = performance.now();
const stats = { frames: 0, times: [] };
const NO_INPUT = { x: 0, y: 0, run: false, jump: false, down: false };
// Away (a photo, the map, the grid): no movement, and strikes or rolls pressed meanwhile don't wait for the return.
function idle() { input.takeStrikes(); input.takeRoll(); input.takeHook(); return NO_INPUT; }
// This frame's input. In the fight pvp.js turns it into movement, shots and strikes (PvP spec §3).
function controls(t) {
  const s = input.state();
  if (!pvp || world.mode !== 'side') return s;
  const m = input.mouse;
  // W/↑ tilt the shot up (and still jump); Space only jumps. On the pad, FIRE with JUMP held shoots up.
  return pvp.control({ ...s, strikes: input.takeStrikes(), roll: input.takeRoll(), hook: input.takeHook(), aimUp: s.y < 0 || padJump, aimDown: s.down,
    mouse: m.on ? { on: true, ...renderer.pointAt(world, m.px, m.py) } : null }, t);
}
let padJump = false; // the pad's JUMP is held
let exitAsks = 0; // world.exit.asks already noted
// In the fight while the side view is up and nothing covers it (PvP spec §8). The tilt out, a photo, the map,
// the grid or a hidden tab take me out (al); coming back puts me in again (ae, with fresh health).
// The arena's keys as you've bound them (keys.js), and the screen to bind them (/).
let keyMap = loadKeys(), keysNow = translate(keyMap), keyScreen = null;
const keyLabel = (id) => keyName(keyOf(keyMap, id));
let keysNoted = false, linkUp = false; // linkUp: this connection's welcome came (so fightOk is its own)
const fightOnline = () => !!live && linkUp && live.state === 'live' && live.fightOk;
function syncFight(t) {
  const want = world.mode === 'side' && !tilting && !world.want && !viewer.isOpen && !mapView.isOpen && !grid.isOpen && !shots?.isOpen && !keyScreen?.isOpen && !document.hidden;
  if (want && !pvp.entered) {
    // A last p first, from in here: arriving by a link or teleport, the last one went out somewhere else,
    // and the gallery would keep drawing me there while I fight.
    if (live) live.tick(world.player);
    pvp.enter(t, fightOnline());
    if (!touch && !keysNoted) { keysNoted = true; note(`${keyLabel('fire')} shoot · ${keyLabel('hit')} hit · ${keyLabel('crouch')} crouch${map.arena.level.hook ? ` · ${keyLabel('hook')} hook` : ''} · mouse aims · / keys`, 4000); }
  } else if (!want && pvp.entered) leaveFight(t);
}
function leaveFight(t) {
  pvp.leave(t);
  if (live) live.leftArena(); // my position goes out again, as p
}
function loop(now) {
  // Real per-frame dt, capped so a background tab doesn't teleport you on return.
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
  last = now;
  if (stationState !== 'off') { requestAnimationFrame(loop); return; } // the station draws; the gallery waits
  const t = performance.now(); // the fight's clock, the same as its messages'
  const away = viewer.isOpen || mapView.isOpen || grid.isOpen || !!shots?.isOpen;
  if (pvp) syncFight(t);
  sideView(t);
  syncView();
  step(world, dt, away ? idle() : controls(t));
  if (!away && world.mode === 'top' && !world.frozen && onStairs()) goDown();
  if (pvp) { syncFight(t); pvp.frame(dt, t); } // through the door: out of the fight as the tilt starts
  if (world.want) tilt();
  // The exit's first hit (exit addendum): it holds, and says how to get out.
  if (world.exit.asks !== exitAsks) { exitAsks = world.exit.asks; note('hit the exit again to leave', 2500); }
  // Side-on the train lights itself; top-down the gallery's light (the train in its box has its own).
  world.lighting = world.mode === 'side' ? null : lightingTop;
  if (world.mode !== lastMode) {
    lastMode = world.mode;
    input.clear(); // nothing held, no strike or roll carried in or out of the arena
    document.body.classList.toggle('side', world.mode === 'side');
    showR(); // [R] is the train's look in the arena, the renderer outside
    showShotsBtn();
    if (world.mode === 'side') meEntry++; // a fresh motion-memory entry: my fly-in plays on every entry
    if (world.mode === 'side' && touch && innerHeight > innerWidth) { note('turn your phone sideways for the arena ↻', 4000); hintOn = true; }
  }
  const showPad = touch && world.mode === 'side' && !viewer.isOpen && !grid.isOpen && !mapView.isOpen && !shots?.isOpen;
  if (padEl.hidden === showPad) {
    padEl.hidden = !showPad;
    document.body.classList.toggle('pad-on', showPad);
    if (!showPad) { input.clear(); padJump = false; }
    padTop = null;
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
  world.entities = stationCountEntities(); // the ▼ SUBWAY sign's count (Multiplayer)
  world.others = [];
  // In the arena's side view people are stick figures (world.bodies → world.figures); top-down they are @.
  const side = world.mode === 'side' && !!map.arena;
  const bodies = [];
  // In the fight, pvp.js knows everyone fighting (me, the others, the dummy) and how they move; the
  // others get their name, chat and emote from live.
  const fight = side && pvp && pvp.entered ? pvp.bodies(t) : [];
  const list = live ? live.peers.list(t) : [];
  for (const b of fight) {
    if (b.me || b.dummy) continue;
    bodies.push(fighterBody(b, list.find((p) => p.id === b.id)));
    const last = live && live.peers.get(b.id);
    wasFighting.set(b.id, { state: b.state, at: t, pAt: last ? last.track.at(-1).t : -Infinity });
  }
  // Hearts: top-down they're entities; in the side view they're labels, drawn over every figure.
  const hearts = side ? [] : world.entities;
  if (live) {
    const now = t;
    live.tick(world.player);
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
    let posOf = (id) => list.find((p) => p.id === id) || null;
    if (side) {
      // Anyone else inside (an old page, or no fight with the server) from their positions alone.
      const fighting = new Set(bodies.map((b) => b.id));
      for (const p of list) {
        if (fighting.has(p.id)) continue;
        // Someone who just stopped fighting (left, closed the tab, or the connection went) has no position
        // newer than before the fight: they stay where they last fought, and fade there.
        const was = wasFighting.get(p.id);
        if (was && !caughtUp(p, was)) {
          if ((p.alpha < 1 || t - was.at < WAS_FIGHTING_MS) && was.state.act !== 'dead') bodies.push(stillBody(p, was.state));
          continue;
        }
        if (was) wasFighting.delete(p.id);
        if (inside(p)) bodies.push(peerBody(p));
      }
      for (const id of wasFighting.keys()) if (!list.some((p) => p.id === id)) wasFighting.delete(id);
      const at = new Map(bodies.map((b) => [b.id, b.state]));
      posOf = (id) => at.get(id) || null;
    } else world.entities.push(...peerEntities(shown, { reducedMotion, muted }));
    hearts.push(...heartEntities(live.peers.hearts(now), map.frames, { reducedMotion, posOf }));
  }
  if (side) {
    const now = performance.now();
    for (let i = 0; i < botCount; i++) {
      const b = botBody(i, now / 1000);
      bodies.push(b);
      // Every fourth bot hearts the arena photo, a heart every 2 s.
      if (i % 4 === 3 && map.arena.backdrop) hearts.push(...heartEntities([{ f: map.arena.backdrop.id, id: b.id, age: ((now / 1000 + i * 0.37) % 2) / 2 }], map.frames, { reducedMotion, posOf: () => b.state }));
    }
    const dummy = fight.find((b) => b.dummy);
    if (dummy) bodies.push({ id: 'dummy', state: dummy.state, color: DUMMY_COLOR, name: '', label: 'dummy', alpha: 1 });
    const meFighting = fight.find((b) => b.me);
    bodies.push(myBody(now, meFighting ? meFighting.state : null));
    pruneHearts(now);
    const my = mine.hearts.map((h) => ({ f: h.f, id: 'me', age: (now - h.at) / MY_HEART_MS }));
    hearts.push(...heartEntities(my, map.frames, { reducedMotion, posOf: () => world.player }));
    const m = renderer.metrics, cols = innerWidth / m.cw, rows = innerHeight / m.ch;
    world.figures = figureGlyphs(bodies, { t: now / 1000, reducedMotion, phone: touch, memory,
      view: { left: world.cam.x - cols / 2, top: world.cam.y - rows / 2, cols, rows }, ceiling: map.arena.y + 1 });
    // Bullets, sparks, damage numbers, hp bars, pickups and sniper lines, over the figures.
    const fx0 = world.figures.length;
    if (fight.length) pvp.glyphs(t, world.figures);
    // Tracers and sparks light the train (its halation), arena-local.
    for (let i = fx0; i < world.figures.length; i++) {
      const g = world.figures[i];
      if (g.glow) trainGlows.push({ x: g.x - map.arena.x - 1, y: g.y - map.arena.y - 1, c: g.color.map((v) => v * Math.min(1, g.a)) });
    }
    // Hearts last: the label layer, over every figure (stickman spec §5 draw order), with the outline.
    for (const h of hearts) world.figures.push({ x: h.x, y: h.y, ch: h.glyph, color: h.color, a: 1, bold: false, strip: false });
  } else {
    world.entities.push(...echo.entities(world.player, map.frames, performance.now(), { reducedMotion }));
    world.entities.push({ x: world.player.x, y: world.player.y, glyph: '@', color: C.player });
    world.figures = [];
  }
  world.bodies = bodies;
  // The train, both side-on and top-down: its frame of the moment, the look, muzzle flashes and glows.
  if (train) {
    const F = decor.frameAt(trainAt ?? t, { reducedMotion });
    if (side && fight.length) {
      F.flashes = pvp.flashes(t); // they light the train (lightAt) and glow (the halation), as tracers do
      trainGlows.push(...flashGlows(F.flashes));
    }
    world.train = { T: train, F, look, glows: trainGlows, paint: decor.paint };
  }
  trainGlows = [];
  if (fightHud) fightHud.render(fight.length ? pvp.hud(t) : null);
  if (renderer.lost) {
    note('WebGL context lost, switched to the canvas renderer');
    setRenderer('canvas');
  }
  // The impact frame (parry addendum §2): IMPACT.delay ms after the kill, that frame is drawn, shown inverted
  // for IMPACT.flash ms, and held, undrawn over, until IMPACT.hold ms after it.
  if (impact && impact.at === null && t >= impact.due) impact.at = t;
  const since = impact && impact.at !== null ? t - impact.at : Infinity;
  stage.classList.toggle('impact', since < IMPACT.flash);
  if (!(since > 0 && since < IMPACT.hold)) renderer.draw(world);
  // The kill's frame is kept (shots.js): copied now, before the browser shows it, baked once the hold is over.
  if (since === 0) shots.capture(stage.querySelector('canvas'), impact.text, IMPACT.hold);
  if (since >= IMPACT.hold && since !== Infinity) impact = null; // not while it waits for its delay
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
// ms. delay: from the kill to the impact, so it lands on the body in pieces in mid-air (stick.js: the pop
// is 0.08 s, then the bones and the head fly up and out, highest and furthest apart about 0.2 s later).
const IMPACT = { delay: 250, flash: 70, hold: 150 };
let impact = null; // a kill I'm in: { due, at, text } in ms; at is null until the frame of it is drawn
let shots = null, shotsNoted = false; // the impact frames kept (shots.js)
// [I]: in the arena always (its switch turns impact frames off); elsewhere once one is kept.
function showShotsBtn() {
  if (!shots) return;
  shotsBtn.hidden = !(world.mode === 'side' || shots.count > 0);
  keysBtn.hidden = world.mode !== 'side';
  shotsBtn.querySelector('.n').textContent = shots.count ? ` ${shots.count}` : '';
}
let lightingTop = null, tilting = false, lastMode = 'top';
let train = null, trainGlows = [], decor = DECOR.train;
let trainAt = null; // __ascii.freezeTrain (localhost): the train held at this time (ms), for screenshots
const loadedIds = new Set();
let following = null, followAt = 0;
// The station (station spec §1): 'off' (the gallery runs), 'down' (fading out, loading), 'in', 'up' (leaving).
let stationState = 'off', station = null;
const fadeEl = document.getElementById('fade');
let fadeGen = 0; // each fade (or instant cover) takes a number; an older fade's timer then leaves the overlay alone
function fade(on, text = '') {
  const gen = ++fadeGen;
  fadeEl.firstElementChild.textContent = text;
  fadeEl.hidden = false;
  if (reducedMotion) { fadeEl.classList.toggle('on', on); fadeEl.hidden = !on; return Promise.resolve(); }
  void fadeEl.offsetWidth; // start the transition from where it is
  fadeEl.classList.toggle('on', on);
  return new Promise((done) => setTimeout(() => { if (!on && gen === fadeGen) fadeEl.hidden = true; done(); }, 320));
}
const onStairs = () => {
  const s = map.stairs && map.stairs.inside;
  if (!s) return false;
  const x = Math.floor(world.player.x), y = Math.floor(world.player.y);
  return x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + s.h;
};
const standAtStairs = () => teleport(world, map.stairs.front.x, map.stairs.front.y);
let downGen = 0;
// A photo, the grid, the map or the impact frames may be open (the forward button): close them the way their
// own buttons do. Their onClose handlers rewrite the hash to the room, so the caller puts #/station back.
async function closePanels(cancelled) {
  // The viewer only closes once it's open (viewer.js has no cancel), so one still opening or closing is waited out,
  // but not past a cancelled trip (the back button): then the caller drops out and the viewer closes on its own.
  for (let i = 0; viewer.isOpen && !cancelled(); i++) { await viewer.close(); if (viewer.isOpen && !cancelled()) await new Promise((r) => setTimeout(r, 50)); }
  if (cancelled()) return;
  if (grid.isOpen) grid.close();
  if (mapView.isOpen) mapView.toggle();
  if (shots?.isOpen) shots.toggle();
}
async function goDown({ instant = false } = {}) {
  if (stationState !== 'off' || !map.stairs) return;
  stationState = 'down';
  music?.setScene('station'); // the jazz goes quiet and muffled, as if from the top of the stairs
  const gen = ++downGen;
  world.frozen = true;
  world.path = null;
  world.onArrive = null;
  stopFollowing();
  input.clear(); // a key held on the way down doesn't walk you, on arrival, onto the exit beside the spawn
  if (instant) { fadeGen++; fadeEl.hidden = false; fadeEl.firstElementChild.textContent = '▼ going down…'; fadeEl.classList.add('on'); }
  else await fade(true, '▼ going down…');
  try {
    await closePanels(() => stationState !== 'down' || gen !== downGen);
    if (stationState !== 'down' || gen !== downGen) return; // the back button won while the panels closed
    if (instant && location.hash !== STATION_HASH) replaceHash(STATION_HASH); // the panels' close handlers rewrote it
    const { startStation } = await import('./rpg/index.js');
    if (stationState !== 'down' || gen !== downGen) return; // the back button won while it loaded
    station = startStation(stage, { onExit: () => goUp(), keys: () => input.state(), reducedMotion, phone: touch, mp: stationNet() });
  } catch (err) {
    console.warn(err);
    if (gen !== downGen || stationState !== 'down') return; // a newer trip owns the state now
    stationState = 'off';
    music?.setScene('gallery');
    standAtStairs();
    world.frozen = false;
    if (location.hash === STATION_HASH) replaceHash('');
    await fade(false);
    note("the station couldn't load", 3000);
    return;
  }
  if (live) live.area('station'); // the gallery sees you leave, the station you arrive (station spec, Multiplayer)
  document.body.classList.add('in-station');
  if (location.hash !== STATION_HASH) history.pushState(null, '', STATION_HASH);
  stationState = 'in';
  await fade(false);
}
async function goUp({ fromHistory = false } = {}) {
  if (stationState === 'down') {
    stationState = 'off'; music?.setScene('gallery'); standAtStairs(); world.frozen = false;
    await fade(false);
    if (fromHistory && location.hash && location.hash !== STATION_HASH) applyRoute(parseRoute(location.hash));
    return;
  }
  if (stationState !== 'in') return;
  stationState = 'up';
  await fade(true);
  try {
    station.stop();
  } finally {
    // Even if stopping the station threw, the gallery comes back.
    station = null;
    document.body.classList.remove('in-station');
    input.clear(); // a key or pad direction held on the way up doesn't carry into the lobby
    standAtStairs();
    if (live) live.area('gallery'); // back in the gallery, at the stairs
    if (!fromHistory && location.hash === STATION_HASH) replaceHash('');
    world.frozen = false;
    stationState = 'off';
    music?.setScene('gallery'); // back up: the jazz comes back in full, where it had got to
    await fade(false);
  }
  stage.focus({ preventScroll: true });
  // Back to a route (a photo, a room): the hashchange that brought you up is applied now you're here.
  if (fromHistory && location.hash && location.hash !== STATION_HASH) applyRoute(parseRoute(location.hash));
}
// Sound (station spec §8): noir jazz in the museum, from the visitor's first key press or tap. Only then does
// music.js load (and the track after it), so the gallery's first load carries none of it; it makes the AudioContext,
// and each later gesture resumes it if the browser held it back. The station moves the same music (no second copy).
let music = null, musicLoading = false;
function unlockAudio(e) {
  if (e.type === 'keydown' && e.target.closest && e.target.closest('input, textarea, [contenteditable]')) return;
  if (music) { music.unlock(); return; }
  if (musicLoading) return;
  musicLoading = true;
  // Making an AudioContext can stall the page for ~0.1 s (the audio device opening), so it waits until you stand still.
  import('./music.js').then((m) => whenStill(() => { music = m; m.unlock({ where: stationState === 'off' ? 'gallery' : 'station' }); })).catch(() => { musicLoading = false; });
}
function whenStill(fn, waited = 0) {
  const s = input ? input.state() : {};
  if ((!s.x && !s.y && !world?.path) || waited > 4000) fn();
  else setTimeout(() => whenStill(fn, waited + 150), 150);
}
addEventListener('keydown', unlockAudio, true);
addEventListener('pointerdown', unlockAudio, true);
const soundBtn = document.getElementById('sound-btn');
if (soundBtn) soundBtn.title = creditText() ? `Sound (V) · ${creditText()}` : 'Sound (V)'; // a credit only for a track that needs one
function showSound(m) {
  if (!soundBtn) return;
  soundBtn.firstChild.textContent = m ? '[×]' : '[♪]';
  soundBtn.lastChild.textContent = m ? ' muted' : ' sound';
  soundBtn.setAttribute('aria-pressed', String(m));
}
showSound(isMuted());
onMuted(showSound);
soundBtn?.addEventListener('click', () => { setMuted(!isMuted()); soundBtn.blur(); });

// Multiplayer in the station (station spec, Multiplayer): what the station needs of live, and the keys while
// you're below: T or Enter opens the chat line, 1–5 emote. stationCount: how many are down there, shown on the
// lobby's ▼ SUBWAY sign.
let stationCount = 0;
function stationNet() {
  if (!live) return null;
  return {
    list: (now) => live.station.list(now),
    tick: (pos) => live.tickStation(pos),
    now: () => live.serverNow(),
    chat: () => document.getElementById('chat-btn').click(),
    emote: (kind) => sendEmote(kind),
  };
}
function stationKey(e) {
  if (!live) return false;
  if (e.code === 'KeyT' || e.key === 'Enter') { document.getElementById('chat-btn').click(); return true; }
  const digit = /^Digit([1-5])$/.exec(e.code);
  if (digit) { sendEmote(EMOTES_ORDER[digit[1] - 1]); return true; }
  return false;
}
// The count after the sign, as glyphs: ' · 2'.
function stationCountEntities() {
  if (!stationCount || !map.stairs) return [];
  const text = ` · ${stationCount}`, x = map.stairs.x + '▼ SUBWAY'.length;
  const color = renderer.name === 'museum' ? [233, 162, 59] : C.sign; // the sign's own colour in each look
  return [...text].map((glyph, k) => ({ x: x + k + 0.5, y: map.stairs.y - 1 + 0.5, glyph, color })).filter((e) => e.glyph !== ' ');
}
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
const pruneHearts = (now) => { mine.hearts = mine.hearts.filter((h) => now - h.at < MY_HEART_MS); };
function sendEmote(kind) {
  const now = performance.now();
  if (!echo.emote(kind, now)) return;
  mine.emote = EMOTE_GLYPH[kind] || null;
  mine.emoteAt = now;
  if (live) live.emote(kind);
  if (station) station.emote(kind);
}
function sendHeart(f) {
  const now = performance.now();
  if (!f || !echo.heart(f.id, now)) return;
  pruneHearts(now);
  mine.hearts.push({ f: f.id, at: now });
  if (live) live.heart(f.id);
}

// The side view's bodies (stickman spec §5, §6). Each has a state for stickPose; the motion memory fills in
// landT and spawnT. __ascii.pose (localhost) pins fields of my state, landT and spawnT included.
let posePin = null, meEntry = 0;
const motion = createMotionMemory();
// My entry is keyed per visit to the side view, so leaving and coming back within the memory's 5 s still
// plays the fly-in (stickman spec §4). Others' respawns come from their own spawnT, so they keep their id.
const memory = {
  fill(id, s, t) {
    motion.fill(id === 'me' ? `me#${meEntry}` : id, s, t);
    if (id === 'me' && posePin) {
      if ('landT' in posePin) s.landT = posePin.landT;
      if ('spawnT' in posePin) s.spawnT = posePin.spawnT;
    }
    return s;
  },
};
// fight: my state from pvp.js, when I'm in the fight.
function myBody(now, fight = null) {
  const p = world.player;
  const own = fight || { x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing, ground: !!p.onGround, low: p.low || 0, flipT: p.t - p.airJumpT, act: 'idle', gun: 'deagle', ...climbLook(p) };
  // A pinned pose is drawn as pinned: unprotected unless `safe` is pinned too.
  const state = posePin ? { ...own, safe: false, ...posePin } : { ...own };
  const emoting = mine.emote && now - mine.emoteAt < MY_EMOTE_MS;
  return { id: 'me', me: true, state, color: C.player, name: '', alpha: 1,
    say: mine.say && now - mine.sayAt < MY_SAY_MS ? mine.say : null,
    emote: emoting ? mine.emote : null, emoteAge: emoting ? (now - mine.emoteAt) / MY_EMOTE_MS : 0 };
}
// Someone fighting: pvp.js's state, with their name, chat and emote from live.
function fighterBody(b, p) {
  return { id: b.id, state: b.state, color: peerColor(b.id), name: (p && p.name) || '', say: p && p.say && !muted.has(b.id) ? p.say : null,
    emote: p ? p.emote : null, emoteAge: p ? p.emoteAge : 0, alpha: 1 };
}
// Ex-fighters: id → { state, at, pAt }, their last fighting state, when, and their newest p then.
const wasFighting = new Map();
const WAS_FIGHTING_MS = 1500; // how long one with no newer p is still drawn (an al, until their p comes)
// A p newer than the fight has come, and the smoothing (which lags) has reached it.
function caughtUp(p, was) {
  const q = live.peers.get(p.id), last = q && q.track.at(-1);
  return !!last && last.t > was.pAt && Math.hypot(p.x - last.x, p.y - last.y) < 0.01;
}
function stillBody(p, s) {
  return { ...peerBody(p), state: { ...s, vx: 0, vy: 0, act: 'idle', actT: 0, safe: false } };
}
// Someone inside who isn't fighting (an old page, or no fight with the server), from their positions alone.
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
    const mapAsked = ARENA.enabled ? chooseMap() : null;
    data = await loadData(undefined, ARENA.enabled ? Object.values(ARENA.photos) : []); // both maps' photos live in the arena
    if (mapAsked) arenaMap = await mapAsked;
  } catch (err) {
    fatal(err);
    return;
  }
  const arenaPhoto = ARENA.enabled ? data.byId.get(ARENA.photos[arenaMap]) || null : null;
  if (ARENA.enabled && !arenaPhoto) console.warn(`ARENA.photos.${arenaMap} "${ARENA.photos[arenaMap]}" isn't in photos.json: the arena has a plain dark backdrop`);
  map = buildLayout(data, SITE, { arena: ARENA.enabled ? { photo: arenaPhoto, level: parseMap(arenaMap, LEVEL_TEXT[arenaMap]) } : null });
  world = createWorld(map, { reducedMotion });
  lightingTop = createLighting(map);
  decor = DECOR[arenaMap];
  train = map.arena ? decor.build(map.arena.level) : null;
  world.lighting = lightingTop;
  input = createInput(stage, { onTap, onKey, arena: () => !!pvp && world.mode === 'side', keys: () => keysNow });
  if (PVP && map.arena) {
    const myId = () => (live && live.peers.myId) || 'me';
    pvp = createPvp({
      world, map, level: map.arena.level, reducedMotion, myId,
      send: (m) => !!live && live.send(m),
      rtt: () => (live && live.rtt) || 100,
      colorOf: (id) => (id === myId() ? C.player : peerColor(id)),
      nameOf: (id) => (live && live.peers.get(id)?.name) || '',
      onNote: (text) => note(text, 3000),
      onImpact: (e) => { if (shots.on) impact = { due: performance.now() + IMPACT.delay, at: null, text: e.text }; },
      onFeed: (text) => {
        fightHud.line(text);
        // For screen readers, politely (the box is aria-hidden); cleared first so a repeat is read again.
        fightSr.textContent = '';
        setTimeout(() => { fightSr.textContent = text; }, 50);
      },
    });
    shots = createShots({
      onOpen: () => { input.clear(); stopFollowing(); },
      onClose: () => stage.focus({ preventScroll: true }),
      onCount: () => {
        showShotsBtn();
        if (!shotsNoted) { shotsNoted = true; note('impact frame kept · I to see and save it', 3000); }
      },
    });
    shotsBtn.addEventListener('click', () => shots.toggle());
    keyScreen = createKeyScreen({
      get: () => keyMap,
      set: (b) => { keyMap = b; keysNow = translate(b); saveKeys(b); input.clear(); },
      onOpen: () => { input.clear(); stopFollowing(); },
      onClose: () => stage.focus({ preventScroll: true }),
    });
    keysBtn.addEventListener('click', () => keyScreen.toggle());
    fightHud = createFightHud({
      root: document.getElementById('fight'), hp: document.getElementById('fight-hp'),
      board: document.getElementById('fight-board'), feed: document.getElementById('fight-feed'),
      streaks: document.getElementById('fight-streaks'),
      rows: touch ? 3 : 5, // a landscape phone shows the top 3
      nameOf: (id) => (live && live.peers.get(id)?.name) || '',
      colorOf: (id, me) => (me ? C.player : peerColor(id)),
    });
    // The tab hidden: out of the fight now (the loop stops while hidden); it puts me back in on return.
    addEventListener('visibilitychange', () => { if (document.hidden && pvp.entered) leaveFight(performance.now()); });
  } else {
    padEl.classList.add('no-fight');
    for (const b of padEl.querySelectorAll('.pad-fire, .pad-hit')) b.hidden = true;
  }
  // The hook's button: only where there is one (the gorge), and only in the fight.
  padEl.querySelector('.pad-hook').hidden = !(pvp && map.arena.level.hook);
  for (const b of padEl.querySelectorAll('button')) {
    const set = (on) => {
      input.press(b.dataset.code, on);
      b.classList.toggle('on', on);
      if (b.dataset.code === 'Jump') padJump = on;
    };
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
  if (!RENDERERS[pick]) { try { pick = localStorage.getItem(RENDERER_KEY); } catch {} }
  setRenderer(RENDERERS[pick] ? pick : 'museum'); // the museum look by default; R cycles to the canvas and WebGL renderers
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
    chatMsg.textContent = mutedFor() > 0 ? mutedText() : '';
    chatForm.hidden = false;
    chatInput.focus();
  });
  // A slur isn't sent: it mutes my chat for LIMITS.muteS, remembered in this browser (the server keeps
  // its own mute too). Swears go out with a letter starred (chat filter addendum).
  const MUTE_KEY = 'faiz-chat-muted';
  const mutedFor = () => { let u = 0; try { u = Number(localStorage.getItem(MUTE_KEY)) || 0; } catch {} return Math.max(0, u - Date.now()); };
  const muteChat = (s) => { try { localStorage.setItem(MUTE_KEY, String(Date.now() + s * 1000)); } catch {} };
  const mutedText = () => `chat muted for ${Math.ceil(mutedFor() / 60000)} min`;
  chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (chatInput.value.trim() === '/admin' && ARENA.enabled) { chatInput.value = ''; closeChat(); admin.open(arenaMap); return; }
    if (hasSlur(chatInput.value)) { muteChat(LIMITS.muteS); chatInput.value = ''; }
    if (mutedFor() > 0) { chatMsg.textContent = mutedText(); return; }
    const text = cleanText(chatInput.value);
    if (text === null) { chatMsg.textContent = chatInput.value.trim() ? 'try different words' : ''; return; }
    const at = performance.now();
    if (!echo.say(text, at)) { chatMsg.textContent = 'one line every 2 s'; return; }
    mine.say = text;
    mine.sayAt = at;
    if (live) live.chat(text);
    if (station) station.say(text);
    addLog(null, '', text);
    chatInput.value = '';
    closeChat();
  });
  chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); closeChat(); } });
  const hereEl = document.getElementById('hud-here');
  // The fight runs online once this connection's welcome agrees on the level (fightOk); otherwise offline.
  const syncOnline = () => { if (pvp && live) pvp.setOnline(fightOnline(), performance.now()); };
  live = createLive({
    version: data.generated,
    fightHash: pvp ? fightHashOf(arenaMap) : '',
    inArena: () => !!pvp && pvp.entered && pvp.online, // the arena stream replaces my position messages
    onArena: (m) => { if (pvp) pvp.onMessage(m, performance.now()); },
    onState: () => { linkUp = false; syncOnline(); },
    getPos: () => world.player,
    getStationPos: () => (station ? station.pos() : null),
    onStation: (n) => { stationCount = n; },
    getName: () => { try { return localStorage.getItem('faiz-live-name') || ''; } catch { return ''; } },
    onCount: (n) => {
      hereEl.hidden = !n;
      hereEl.textContent = `${n} here`;
      // Also called on the welcome, just after it set fightOk.
      if (live && live.state === 'live') { linkUp = true; syncOnline(); }
    },
    onAnnounce: (kind, m) => {
      // Only people in your room are announced, to keep screen readers quiet.
      if (roomAt(map, m.x, m.y) !== roomAt(map, world.player.x, world.player.y)) return;
      captionEl.setAttribute('aria-live', 'polite');
      note(`${m.name || 'someone'} ${kind === 'join' ? 'joined' : 'left'}`, 2000);
    },
    onRejected: () => note('try another name'),
    onChat: ({ id, name, text }) => { if (!muted.has(id)) addLog(id, name, text); },
    onChatRejected: () => note('try different words'),
    onChatMuted: (s) => { muteChat(s); note(mutedText()); },
    onMap: (name) => { if (ARENA.enabled) followMap(name); },
    onAdmin: (ok, name) => admin.answer(ok, name),
  });
  if (live) { emoteBtn.hidden = false; nameBtn.hidden = false; chatBtn.hidden = false; }
  const adminForm = document.getElementById('admin-form');
  admin = createAdmin({
    form: adminForm, input: document.getElementById('admin-pw'), msg: document.getElementById('admin-msg'),
    now: document.getElementById('admin-now'), buttons: adminForm.querySelectorAll('button'),
    send: (name, pw) => (live ? live.admin(name, pw) === true || null : false), // null: there's a server, but not connected
    check: adminOk,
    local: (name) => followMap(name),
    onClose: () => stage.focus({ preventScroll: true }),
  });
  // Back in the arena after a map switch reloaded the page (followMap).
  let back = false;
  try { back = sessionStorage.getItem(BACK_KEY) === '1'; sessionStorage.removeItem(BACK_KEY); } catch {}
  if (back && map.arena) teleport(world, map.arena.entry.x + 0.5, map.arena.floorY - 1.5);
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
  addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (stationState !== 'off' && (!route || route.kind !== 'station')) { goUp({ fromHistory: true }); return; }
    applyRoute(route);
  });

  // Test hook for the e2e scripts.
  window.__ascii = { map, world, stats, viewer, mode: () => world.mode, station: () => stationState, tilting: () => tilting, loaded: (id) => loadedIds.has(id), teleport: (x, y) => teleport(world, x, y), walkTo: (x, y) => walkTo(world, x, y),
    open: (id) => openFrame(map.frames.find((f) => f.id === id)), grid, tapCell: (x, y) => { const m = renderer.metrics; onTap((x + 0.5 - world.cam.x) * m.cw + innerWidth / 2, (y + 0.5 - world.cam.y) * m.ch + innerHeight / 2); }, setRenderer, live: () => live, metrics: () => renderer.metrics, get renderer() { return renderer.name; },
    look: () => look, zoom: () => zoom, missing: () => [...(renderer.missing || [])], pointAt: (px, py) => renderer.pointAt(world, px, py) };
  // Pins fields of my side-view state (act, actT, aim, x, y, landT, spawnT…) until called with null.
  if (onLocalhost) window.__ascii.pose = (state) => { posePin = state ? { ...state } : null; };
  if (onLocalhost) window.__ascii.freezeTrain = (t) => { trainAt = t; };
  window.__ascii.pvp = () => pvp;
  window.__ascii.input = () => input;
  window.__ascii.music = () => (music ? music.musicState() : { state: 'none', sources: 0, loaded: false, requested: musicLoading });
  requestAnimationFrame((t) => { last = t; loop(t); });
}

boot();
