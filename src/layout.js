// The building, in the 3/4 view: a wall that runs east-west shows its face, a band you look at, and the
// prints hang upright on it. A colour room has its north wall's face and, with 4+ photos, an island (a
// freestanding wall) whose face looks back at you: half the prints on each. The lobby's north wall shows a
// short face too. Digital photos fill the north wing and film the south, both split into colour rooms;
// black & white from both hangs in the darkroom.
//
// For comparing, in the address: ?wings=color (warm north, cool south, film in the darkroom), ?view=flat
// (the plan view: prints on north and south walls, islands hung on both faces; ?islands=0 drops them).
//
// Rooms → a tile map. Deterministic: the same data always gives the same building.
//
//            north wing (Medium Format)
//                    │
//              ┌── LOBBY ──┐── east: Darkroom
//                    │
//            south wing (X Series)
//
// Each wing is a corridor with rooms alternating on its west and east sides. Rooms share a wall
// with the corridor and have a 3-row doorway in it, so every door sits on a side wall.

import { blockText } from './blockfont.js';
import { plaqueText } from './data.js';
import { groupByColor } from './colors.js';

const PARAMS = new URLSearchParams(typeof location !== 'undefined' ? location.search : '');
export const VIEW = PARAMS.get('view') === 'flat' ? 'flat' : 'face';
const ISLANDS = PARAMS.get('islands') !== '0';
export const WINGS = PARAMS.get('wings') === 'color' ? 'color' : 'format';

// Digital north, film south, both by colour. groupByColor always sends film to the darkroom, so the film
// is grouped as if it weren't (then given back as itself).
function byFormat(data) {
  const all = data.rooms.flatMap((r) => r.photos);
  const digital = all.filter((p) => p.category !== 'film'), film = all.filter((p) => p.category === 'film');
  // black & white from both (each group's 'silver' room) hangs together in the darkroom
  const bw = [];
  const rooms = [];
  for (const r of groupByColor(digital)) if (r.id === 'silver') bw.push(...r.photos); else rooms.push({ ...r, wing: 'north' });
  const own = new Map(film.map((p) => [p.id, p]));
  for (const r of groupByColor(film.map((p) => ({ ...p, category: 'film-as-colour' })))) {
    const photos = r.photos.map((p) => own.get(p.id));
    if (r.id === 'silver') { bw.push(...photos); continue; }
    rooms.push({ ...r, id: `film-${r.id}`, name: `${r.name} Film`, wing: 'south', photos,
      subtitle: `${photos.length} film print${photos.length === 1 ? '' : 's'}` });
  }
  rooms.push({ id: 'darkroom', name: 'Darkroom', subtitle: `${bw.length} black & white prints · safelight on`, wing: 'east', hue: 0, photos: bw });
  return { ...data, rooms };
}
const FWALK = 8; // rows of open floor in front of a face
const SHORT = 3; // the lobby's north wall face
const IWALK = 7; // rows of open floor in each aisle of a room with an island
const IEND = 5; // open floor at each end of an island, so you can walk round it

export const T = { VOID: 0, FLOOR: 1, WALL: 2, DOOR: 3, PROP: 4 };
export const CELL_ASPECT = 2; // cell height / width

const GAP = 3; // cells between frames on a wall
const MARGIN = 3; // cells between a wall's end and its first frame
const WALK = 9; // rows of open floor between the two walls of frames
const CORRIDOR = 7; // interior width of a north/south corridor, in columns
const DARK_CORRIDOR = 10; // length of the corridor from the lobby to the darkroom

// The full plaque (camera · year) if it fits, else just the year.
function fitPlaque(p, width) {
  const full = plaqueText(p);
  if (full.length <= width) return full;
  const year = p.year ? String(p.year) : '';
  return year.length <= width ? year : '';
}

export function frameSize(p) {
  const aspect = p.aspect || p.width / p.height || 1.5;
  let rows = p.hero ? 15 : 11;
  if (aspect < 0.5) rows = 22;
  let cols = Math.round(rows * aspect * CELL_ASPECT);
  if (cols > 60) {
    cols = 60;
    rows = Math.max(5, Math.round(60 / (aspect * CELL_ASPECT)));
  }
  cols = Math.max(6, cols);
  return { cols, rows };
}

// Lay one room out in local interior coordinates (0,0 = first floor cell).
function planRoom(room, darkroom) {
  const items = room.photos.map((p) => {
    const { cols, rows } = frameSize(p);
    return { photo: p, cols, rows, w: cols + 2, h: rows + 3 }; // box + plaque
  });
  if (VIEW === 'face' && !darkroom) return planFaceRoom(room, items);
  if (ISLANDS && !darkroom && items.length >= 4) return planIslandRoom(room, items);
  const walls = [[], []];
  const width = [0, 0];
  for (const it of items) {
    const i = width[0] <= width[1] ? 0 : 1;
    walls[i].push(it);
    width[i] += it.w + GAP;
  }
  const hTop = Math.max(0, ...walls[0].map((i) => i.h));
  const hBot = Math.max(0, ...walls[1].map((i) => i.h));
  const titleW = Math.max(room.name.length, (room.subtitle || '').length) + 10;
  const W = Math.max(36, titleW, ...width.map((w) => w - GAP + 2 * MARGIN));
  const bench = darkroom ? 6 : 0;
  const H = hTop + WALK + hBot + bench;
  const frames = [];
  walls.forEach((list, wi) => {
    const total = list.reduce((s, i) => s + i.w, 0) + GAP * Math.max(0, list.length - 1);
    let x = Math.floor((W - total) / 2);
    for (const it of list) {
      // Top row hangs from the north wall. Bottom row hangs on the south wall,
      // or in the darkroom from a second clothesline, both with the plaque below.
      const top = wi === 0 ? 0 : darkroom ? hTop + WALK - 1 : H - (it.rows + 2);
      const plaqueY = wi === 0 || darkroom ? top + it.rows + 2 : top - 1;
      const standY = wi === 0 ? hTop + 1 : darkroom ? top - 2 : H - hBot - 2;
      frames.push({
        photo: it.photo,
        cols: it.cols,
        rows: it.rows,
        x,
        y: top,
        w: it.w,
        h: it.rows + 2,
        plaque: { x: x + 1, y: plaqueY, text: fitPlaque(it.photo, it.cols) },
        stand: { x: x + Math.floor(it.w / 2), y: standY },
        wall: wi === 0 ? 'n' : 's',
      });
      x += it.w + GAP;
    }
  });
  const doorY = hTop + Math.floor(WALK / 2) - 1; // 3 rows: doorY..doorY+2
  return { W, H, frames, doorY, hTop, hBot, darkroom };
}

// The 3/4 view: the north wall's face (a band: a lamp row, the prints, their plaques, a skirting), floor
// in front of it, then (4+ photos) an island: its top seen from above (a wall row) over its face, and more
// floor. Prints split between the two faces by width; each face is as tall as its tallest print needs.
function planFaceRoom(room, items) {
  const split = items.length >= 4;
  const lists = split ? [[], []] : [[]], width = lists.map(() => 0);
  items.map((it, k) => ({ it, k })).sort((a, b) => b.it.w - a.it.w).forEach(({ it, k }) => {
    const i = width.indexOf(Math.min(...width));
    lists[i].push({ ...it, k });
    width[i] += it.w + GAP;
  });
  lists.forEach((l) => l.sort((a, b) => a.k - b.k));
  const span = (i) => Math.max(0, width[i] - GAP);
  const islandW = split ? span(1) + 4 : 0;
  const titleW = Math.max(room.name.length, (room.subtitle || '').length) + 10;
  const W = Math.max(36, titleW, span(0) + 2 * MARGIN, split ? islandW + 2 * IEND : 0);
  const tallest = (l) => Math.max(...l.map((it) => it.rows + 2));
  const faceH = (l) => tallest(l) + 4; // lamp row, print, plaque, skirting
  const frames = [], faces = [], caps = [];
  const hang = (list, faceY, faceX, faceW) => {
    const total = list.reduce((s, i) => s + i.w, 0) + GAP * Math.max(0, list.length - 1);
    let x = faceX + Math.floor((faceW - total) / 2);
    const fh = faceH(list);
    for (const it of list) {
      const top = faceY + 1 + Math.floor((tallest(list) - (it.rows + 2)) / 2);
      frames.push({
        photo: it.photo, cols: it.cols, rows: it.rows, x, y: top, w: it.w, h: it.rows + 2,
        plaque: { x: x + 1, y: top + it.rows + 2, text: fitPlaque(it.photo, it.cols) },
        stand: { x: x + Math.floor(it.w / 2), y: faceY + fh + 1 }, wall: 'n',
      });
      x += it.w + GAP;
    }
    return fh;
  };
  const hA = hang(lists[0], 0, 0, W);
  faces.push({ x: 0, y: 0, w: W, h: hA, kind: 'wall' });
  let H = hA + FWALK + 2;
  if (split) {
    const capY = hA + FWALK, ix = Math.floor((W - islandW) / 2);
    const hB = hang(lists[1], capY + 1, ix, islandW);
    caps.push({ x: ix, y: capY, w: islandW, h: 1 });
    faces.push({ x: ix, y: capY + 1, w: islandW, h: hB, kind: 'island' });
    H = capY + 1 + hB + FWALK;
  }
  return { W, H, frames, doorY: hA + Math.floor(FWALK / 2) - 1, hTop: hA, hBot: 0, darkroom: false, faces, caps };
}

// Four rows of prints, top to bottom: the north wall; the island's north face; its south face; the south
// wall. The island is a 2-row wall, so a lamp can sit over each face's prints.
function planIslandRoom(room, items) {
  const lists = [[], [], [], []], width = [0, 0, 0, 0];
  items.map((it, k) => ({ it, k })).sort((a, b) => b.it.w - a.it.w).forEach(({ it, k }) => {
    const i = width.indexOf(Math.min(...width));
    lists[i].push({ ...it, k });
    width[i] += it.w + GAP;
  });
  lists.forEach((l) => l.sort((a, b) => a.k - b.k)); // keep the photos' order within a row
  const span = (i) => Math.max(0, width[i] - GAP);
  const islandW = Math.max(span(1), span(2)) + 4;
  const titleW = Math.max(room.name.length, (room.subtitle || '').length) + 10;
  const W = Math.max(36, titleW, span(0) + 2 * MARGIN, span(3) + 2 * MARGIN, islandW + 2 * IEND);
  const hgt = (i) => Math.max(0, ...lists[i].map((it) => it.h));
  const hN = hgt(0), hIN = hgt(1), hIS = hgt(2), hS = hgt(3);
  const spineY = hN + IWALK + hIN;
  const yS = spineY + 2 + hIS + IWALK;
  const H = yS + hS;
  const frames = [];
  lists.forEach((list, li) => {
    const total = list.reduce((s, i) => s + i.w, 0) + GAP * Math.max(0, list.length - 1);
    let x = Math.floor((W - total) / 2);
    for (const it of list) {
      // rows 0 and 2 hang below a wall (plaque under the print); rows 1 and 3 hang above one (plaque over it)
      const top = li === 0 ? 0 : li === 1 ? spineY - (it.rows + 2) : li === 2 ? spineY + 2 : H - (it.rows + 2);
      const below = li === 0 || li === 2;
      const standY = li === 0 ? hN + 1 : li === 1 ? hN + IWALK - 2 : li === 2 ? spineY + 2 + hIS + 1 : yS - 2;
      frames.push({
        photo: it.photo, cols: it.cols, rows: it.rows, x, y: top, w: it.w, h: it.rows + 2,
        plaque: { x: x + 1, y: below ? top + it.rows + 2 : top - 1, text: fitPlaque(it.photo, it.cols) },
        stand: { x: x + Math.floor(it.w / 2), y: standY },
        wall: below ? 'n' : 's', island: li === 1 || li === 2,
      });
      x += it.w + GAP;
    }
  });
  const doorY = hN + Math.floor(IWALK / 2) - 1;
  const islands = [{ x: Math.floor((W - islandW) / 2), y: spineY, w: islandW, h: 2 }];
  return { W, H, frames, doorY, hTop: hN, hBot: hS, darkroom: false, islands };
}

export function buildLayout(data, site, { arena = null } = {}) {
  if (WINGS === 'format') data = byFormat(data);
  const rects = []; // everything in world coordinates; normalized at the end
  const rooms = [];

  // Lobby
  const nameLines = blockText(site.name);
  const lobbyW = Math.max(72, nameLines[0].length + 12);
  const lobbyH = 26;
  const lobby = { id: 'lobby', name: 'Lobby', subtitle: '', wing: null, x: 0, y: 0, w: lobbyW + 2, h: lobbyH + 2, frames: [] };
  rooms.push(lobby);
  const cx = Math.floor(lobby.w / 2);
  const cy = Math.floor(lobby.h / 2);

  const doors = []; // {x,y} cells to carve
  const labels = []; // {x,y,text,role}
  const corridors = [];

  // The darkroom sits just east of the lobby, a short corridor away. It is taller than the lobby, so
  // the wing rooms on the east side of each corridor start beyond it instead of crowding it out.
  const dark = data.rooms.find((r) => r.wing === 'east');
  const darkPlan = dark ? planRoom(dark, true) : null;
  const darkBox = darkPlan && { x: lobby.x + lobby.w - 1 + DARK_CORRIDOR, y: cy - 2 - darkPlan.doorY, w: darkPlan.W + 2, h: darkPlan.H + 2 };
  // West: the arena, a corridor's length past the lobby's west wall. Its door is the 3 rows of its east
  // wall ending on the level's D (the floor line), level with the corridor, so you walk in along its floor.
  // It rises far above the lobby, so the north wing's west-side rooms start beyond it.
  const doorRow = arena ? (arena.level.door ? arena.level.door.r : arena.level.rows - 1) : 0;
  const arenaBox = arena && {
    x: lobby.x - DARK_CORRIDOR - (arena.level.cols + 2) + 1, y: cy - doorRow,
    w: arena.level.cols + 2, h: arena.level.rows + 2,
  };

  // North / south wings
  for (const [wing, dir] of [['north', -1], ['south', 1]]) {
    const list = data.rooms.filter((r) => r.wing === wing);
    if (!list.length) continue;
    const cor = { x: cx - Math.floor(CORRIDOR / 2) - 1, w: CORRIDOR + 2 };
    // cursor = the next room's edge row nearest the lobby (one void row away from the last thing placed)
    const cursor = { west: dir < 0 ? lobby.y - 2 : lobby.y + lobby.h + 1, east: dir < 0 ? lobby.y - 2 : lobby.y + lobby.h + 1 };
    if (darkBox) cursor.east = dir < 0 ? Math.min(cursor.east, darkBox.y - 2) : Math.max(cursor.east, darkBox.y + darkBox.h + 1);
    if (arenaBox) cursor.west = dir < 0 ? Math.min(cursor.west, arenaBox.y - 2) : Math.max(cursor.west, arenaBox.y + arenaBox.h + 1);
    let far = cursor.west;
    list.forEach((room, i) => {
      const side = i % 2 === 0 ? 'west' : 'east';
      const plan = planRoom(room, false);
      const w = plan.W + 2, h = plan.H + 2;
      const x = side === 'west' ? cor.x - w + 1 : cor.x + cor.w - 1;
      const y = dir < 0 ? cursor[side] - h + 1 : cursor[side];
      cursor[side] = dir < 0 ? y - 2 : y + h + 1;
      far = dir < 0 ? Math.min(far, y) : Math.max(far, y + h - 1);
      const doorX = side === 'west' ? x + w - 1 : x;
      for (let k = 0; k < 3; k++) doors.push({ x: doorX, y: y + 1 + plan.doorY + k });
      rooms.push({ id: room.id, name: room.name, subtitle: room.subtitle, hue: room.hue, wing, x, y, w, h, plan, side,
        entry: { x: side === 'west' ? doorX - 2 : doorX + 2, y: y + 1 + plan.doorY + 1 } });
    });
    const y0 = dir < 0 ? far : lobby.y + lobby.h - 1;
    const y1 = dir < 0 ? lobby.y : far;
    corridors.push({ x: cor.x, y: y0, w: cor.w, h: y1 - y0 + 1 });
    const wallY = dir < 0 ? lobby.y : lobby.y + lobby.h - 1;
    for (let k = 1; k <= CORRIDOR; k++) doors.push({ x: cor.x + k, y: wallY });
    const signY = dir < 0 ? lobby.y + 2 : lobby.y + lobby.h - 3;
    const sign = WINGS === 'format' ? (dir < 0 ? '↑  digital  ↑' : '↓   film   ↓') : dir < 0 ? '↑   warm   ↑' : '↓   cool   ↓';
    labels.push({ x: cx - Math.floor(sign.length / 2), y: signY, text: sign, role: 'sign' });
  }

  // East: a short corridor to the darkroom
  if (dark) {
    const plan = darkPlan;
    const { x, y, w, h } = darkBox;
    const corLen = x - (lobby.x + lobby.w - 1);
    corridors.push({ x: lobby.x + lobby.w - 1, y: cy - 2, w: corLen + 1, h: 5 });
    for (let k = -1; k <= 1; k++) {
      doors.push({ x: lobby.x + lobby.w - 1, y: cy + k });
      doors.push({ x, y: cy + k });
    }
    rooms.push({ id: dark.id, name: dark.name, subtitle: dark.subtitle, hue: 0, wing: 'east', x, y, w, h, plan, side: 'east',
      entry: { x: x + 2, y: cy } });
    const sign = 'DARKROOM →';
    labels.push({ x: lobby.x + lobby.w - 3 - sign.length, y: cy - 3, text: sign, role: 'sign' });
  }

  // West: a short corridor to the arena
  if (arena) {
    const { x, y, w, h } = arenaBox;
    const east = x + w - 1;
    corridors.push({ x: east, y: cy - 2, w: lobby.x - east + 1, h: 5 });
    for (let k = -1; k <= 1; k++) {
      doors.push({ x: lobby.x, y: cy + k });
      doors.push({ x: east, y: cy + k });
    }
    rooms.push({ id: 'arena', name: 'Arena', subtitle: '', hue: null, wing: 'west', x, y, w, h, side: 'west', arena: true, frames: [],
      entry: { x: east - 1, y: cy + 1 } });
    labels.push({ x: lobby.x + 2, y: cy - 3, text: '← ARENA', role: 'sign' });
  }

  // Normalize to a grid with padding
  const all = [...rooms, ...corridors];
  const minX = Math.min(...all.map((r) => r.x)) - 2;
  const minY = Math.min(...all.map((r) => r.y)) - 2;
  const W = Math.max(...all.map((r) => r.x + r.w)) - minX + 2;
  const H = Math.max(...all.map((r) => r.y + r.h)) - minY + 2;
  const shift = (o) => { o.x -= minX; o.y -= minY; };
  all.forEach(shift);
  doors.forEach(shift);
  labels.forEach(shift);
  rooms.forEach((r) => r.entry && shift(r.entry));

  const tiles = new Uint8Array(W * H);
  const roomOf = new Int16Array(W * H).fill(-1);
  const glyphs = new Map(); // idx → { ch, role } for props and floor decals
  const at = (x, y) => y * W + x;
  const fillRect = (r, idx) => {
    for (let y = r.y; y < r.y + r.h; y++) {
      for (let x = r.x; x < r.x + r.w; x++) {
        const edge = x === r.x || y === r.y || x === r.x + r.w - 1 || y === r.y + r.h - 1;
        const i = at(x, y);
        if (edge) { if (tiles[i] !== T.FLOOR) tiles[i] = T.WALL; }
        else { tiles[i] = T.FLOOR; roomOf[i] = idx; }
      }
    }
  };
  corridors.forEach((c) => fillRect(c, -1));
  rooms.forEach((r, i) => fillRect(r, i));
  doors.forEach((d) => { tiles[at(d.x, d.y)] = T.DOOR; });
  const faces = []; // the 3/4 view's wall faces, in world cells: { x, y, w, h, kind, room }
  rooms.forEach((r, ri) => {
    if (!r.plan) return;
    for (const c of r.plan.caps || []) for (let x = c.x; x < c.x + c.w; x++) { const i = at(r.x + 1 + x, r.y + 1 + c.y); tiles[i] = T.WALL; roomOf[i] = -1; }
    for (const f of r.plan.faces || []) {
      faces.push({ x: r.x + 1 + f.x, y: r.y + 1 + f.y, w: f.w, h: f.h, kind: f.kind, room: ri });
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) tiles[at(r.x + 1 + x, r.y + 1 + y)] = T.PROP;
    }
  });
  if (VIEW === 'face') {
    // the lobby's north wall: a short face wherever it is wall (the corridor's opening stays open)
    let run = null;
    const flush = () => { if (run) { faces.push(run); run = null; } };
    for (let x = lobby.x + 1; x < lobby.x + lobby.w - 1; x++) {
      if (tiles[at(x, lobby.y)] === T.WALL) {
        for (let y = lobby.y + 1; y <= lobby.y + SHORT; y++) tiles[at(x, y)] = T.PROP;
        if (run) run.w++; else run = { x, y: lobby.y + 1, w: 1, h: SHORT, kind: 'short', room: 0 };
      } else flush();
    }
    flush();
  }
  rooms.forEach((r) => (r.plan && r.plan.islands || []).forEach((is) => {
    for (let y = is.y; y < is.y + is.h; y++) for (let x = is.x; x < is.x + is.w; x++) { const i = at(r.x + 1 + x, r.y + 1 + y); tiles[i] = T.WALL; roomOf[i] = -1; }
  }));

  // Frames → world coordinates
  const frames = [];
  rooms.forEach((r, ri) => {
    if (!r.plan) return;
    const ox = r.x + 1, oy = r.y + 1;
    r.frames = r.plan.frames.map((f) => {
      const frame = {
        id: f.photo.id, photo: f.photo, room: r.id, roomIndex: ri, cols: f.cols, rows: f.rows,
        x: f.x + ox, y: f.y + oy, w: f.w, h: f.h, wall: f.wall, island: !!f.island, darkroom: r.plan.darkroom,
        plaque: { ...f.plaque, x: f.plaque.x + ox, y: f.plaque.y + oy },
        stand: { x: f.stand.x + ox, y: f.stand.y + oy },
        sway: ((frames.length * 2654435761) % 1000) / 1000, // stable per-frame phase
      };
      frames.push(frame);
      for (let y = frame.y; y < frame.y + frame.h; y++)
        for (let x = frame.x; x < frame.x + frame.w; x++) tiles[at(x, y)] = T.PROP;
      return frame;
    });
    // Room title painted on the floor in the walkway
    const ly = oy + r.plan.hTop + 2;
    const title = `═══ ${r.name} ═══`;
    labels.push({ x: ox + Math.floor((r.plan.W - title.length) / 2), y: ly, text: title, role: 'title', room: ri });
    if (r.subtitle) labels.push({ x: ox + Math.floor((r.plan.W - r.subtitle.length) / 2), y: ly + 1, text: r.subtitle, role: 'subtitle' });
  });

  // The arena's photo, the train's inspiration: one big frame over the room that E opens. It is never drawn
  // (the train is). Its cells stay floor (not props) so you can walk and jump in front of it.
  let arenaInfo = null;
  const ar = rooms.find((r) => r.arena);
  if (ar) {
    const index = rooms.indexOf(ar);
    const { cols, rows } = arena.level;
    if (arena.photo) {
      const f = {
        id: arena.photo.id, photo: arena.photo, room: ar.id, roomIndex: index, cols, rows,
        x: ar.x, y: ar.y, w: ar.w, h: ar.h, wall: 'n', darkroom: false, backdrop: true,
        plaque: { x: ar.x + 1, y: ar.y + ar.h, text: '' }, stand: { ...ar.entry }, sway: 0,
      };
      ar.frames = [f];
      frames.push(f);
    }
    arenaInfo = {
      index, x: ar.x, y: ar.y, w: ar.w, h: ar.h, cols, rows, level: arena.level, backdrop: ar.frames[0] || null,
      entry: ar.entry, door: { x: ar.x + ar.w - 1, y: ar.entry.y - 2 }, floorY: ar.y + 1 + doorRow + 1, // the row under the door
    };
  }

  // Darkroom clotheslines and bench
  const darkroom = rooms.find((r) => r.plan && r.plan.darkroom);
  const lines = [];
  if (darkroom) {
    const ox = darkroom.x + 1;
    for (const y of new Set(darkroom.frames.map((f) => f.y))) lines.push({ x: ox, y, w: darkroom.w - 2 });
    const benchArt = [
      '  ┌┴┐                                 ',
      '  │▓│      ┌──────┐ ┌──────┐ ┌──────┐ ',
      ' ┌┴─┴┐     │~~~~~~│ │~~~~~~│ │~~~~~~│ ',
      '═╧═══╧═════╧══════╧═╧══════╧═╧══════╧═',
    ];
    const bx = ox + 2, by = darkroom.y + darkroom.h - 1 - benchArt.length - 1;
    benchArt.forEach((line, dy) => [...line].forEach((ch, dx) => {
      if (ch === ' ') return;
      const i = at(bx + dx, by + dy);
      tiles[i] = T.PROP;
      glyphs.set(i, { ch, role: 'prop' });
    }));
  }

  // Lobby sign: name, tagline, about
  const nameY = lobby.y + 5;
  nameLines.forEach((line, k) => labels.push({ x: lobby.x + Math.floor((lobby.w - line.length) / 2), y: nameY + k, text: line, role: 'name' }));
  if (site.tagline) {
    const tag = site.tagline.split('').join(' ');
    labels.push({ x: lobby.x + Math.floor((lobby.w - tag.length) / 2), y: nameY + 6, text: tag, role: 'tagline' });
  }
  wrap(site.about || '', Math.min(56, lobby.w - 10)).forEach((line, k) =>
    labels.push({ x: lobby.x + Math.floor((lobby.w - line.length) / 2), y: nameY + 9 + k, text: line, role: 'about' }));

  // An information desk under the name, with an attendant behind it: it opens every photo as a grid.
  const lobbyText = labels.filter((l) => ['name', 'tagline', 'about'].includes(l.role));
  const top = Math.max(...lobbyText.map((l) => l.y)) + 2;
  const kText = 'view all photos';
  const kw = kText.length + 8;
  const kiosk = { x: lobby.x + Math.round((lobby.w - kw) / 2), y: top + 2, w: kw, h: 3 };
  kiosk.stand = { x: kiosk.x + Math.floor(kiosk.w / 2), y: kiosk.y + kiosk.h };
  kiosk.attendant = { x: kiosk.stand.x, y: kiosk.y - 1 };
  const kRows = ['╔' + '═'.repeat(kw - 2) + '╗', '║' + ' '.repeat(kw - 2) + '║', '╚' + '═'.repeat(kw - 2) + '╝'];
  kRows.forEach((line, dy) => [...line].forEach((ch, dx) => {
    const i = at(kiosk.x + dx, kiosk.y + dy);
    tiles[i] = T.PROP;
    if (ch !== ' ') glyphs.set(i, { ch, role: 'prop' });
  }));
  tiles[at(kiosk.attendant.x, kiosk.attendant.y)] = T.PROP;
  labels.push({ x: kiosk.x + 4, y: kiosk.y + 1, text: kText, role: 'kiosk' });
  const sign = '· information ·';
  labels.push({ x: kiosk.x + Math.round((kw - sign.length) / 2), y: top, text: sign, role: 'sign' });

  // You start just below the desk, facing it.
  const spawn = { x: lobby.x + cx + 0.5, y: Math.min(lobby.y + lobby.h - 3, Math.max(lobby.y + lobby.h - 6, kiosk.stand.y + 3)) + 0.5 };
  return { W, H, tiles, roomOf, glyphs, rooms, frames, labels, lines, spawn, kiosk, arena: arenaInfo, faces, view: VIEW };
}

function wrap(text, width) {
  const out = [];
  let line = '';
  for (const word of text.split(/\s+/)) {
    if ((line + ' ' + word).trim().length > width) { out.push(line); line = word; }
    else line = (line + ' ' + word).trim();
  }
  if (line) out.push(line);
  return out;
}

export const isWalkable = (map, x, y) => {
  if (x < 0 || y < 0 || x >= map.W || y >= map.H) return false;
  const t = map.tiles[y * map.W + x];
  return t === T.FLOOR || t === T.DOOR;
};
