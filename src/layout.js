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

export function buildLayout(data, site) {
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

  // North / south wings
  for (const [wing, dir] of [['north', -1], ['south', 1]]) {
    const list = data.rooms.filter((r) => r.wing === wing);
    if (!list.length) continue;
    const cor = { x: cx - Math.floor(CORRIDOR / 2) - 1, w: CORRIDOR + 2 };
    // cursor = the next room's edge row nearest the lobby (one void row away from the last thing placed)
    const cursor = { west: dir < 0 ? lobby.y - 2 : lobby.y + lobby.h + 1, east: dir < 0 ? lobby.y - 2 : lobby.y + lobby.h + 1 };
    if (darkBox) cursor.east = dir < 0 ? Math.min(cursor.east, darkBox.y - 2) : Math.max(cursor.east, darkBox.y + darkBox.h + 1);
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
    const sign = dir < 0 ? '↑   warm   ↑' : '↓   cool   ↓';
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

  // Frames → world coordinates
  const frames = [];
  rooms.forEach((r, ri) => {
    if (!r.plan) return;
    const ox = r.x + 1, oy = r.y + 1;
    r.frames = r.plan.frames.map((f) => {
      const frame = {
        id: f.photo.id, photo: f.photo, room: r.id, roomIndex: ri, cols: f.cols, rows: f.rows,
        x: f.x + ox, y: f.y + oy, w: f.w, h: f.h, wall: f.wall, darkroom: r.plan.darkroom,
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

  // A kiosk in the lobby's south-west corner opens every photo as a grid.
  const kText = '[ view all photos ]';
  const kiosk = { x: lobby.x + 5, y: lobby.y + lobby.h - 6, w: kText.length + 4, h: 3 };
  kiosk.stand = { x: kiosk.x + Math.floor(kiosk.w / 2), y: kiosk.y + kiosk.h };
  const kRows = ['┌' + '─'.repeat(kiosk.w - 2) + '┐', '│' + ' '.repeat(kiosk.w - 2) + '│', '└' + '─'.repeat(kiosk.w - 2) + '┘'];
  kRows.forEach((line, dy) => [...line].forEach((ch, dx) => {
    const i = at(kiosk.x + dx, kiosk.y + dy);
    tiles[i] = T.PROP;
    if (ch !== ' ') glyphs.set(i, { ch, role: 'prop' });
  }));
  labels.push({ x: kiosk.x + 2, y: kiosk.y + 1, text: kText, role: 'kiosk' });

  const spawn = { x: lobby.x + cx + 0.5, y: lobby.y + lobby.h - 6 + 0.5 };
  return { W, H, tiles, roomOf, glyphs, rooms, frames, labels, lines, spawn, kiosk };
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
