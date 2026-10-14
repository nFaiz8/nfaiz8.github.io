// Renderer A: every cell is drawn as a character on a 2D canvas. Static things (walls, floor, labels,
// still photos) are baked into chunk canvases; each frame only blits them and draws what moves.
import { cellMetrics, drawGlyph, prepareText, rgb } from './glyphs.js';
import { C, LABEL_COLOR, roomTint } from './palette.js';
import { RAMP } from '../ascii.js';
import { T } from '../layout.js';
import { loadImage, cellsFor, hasFailed } from '../photos.js';
import { lightWindow } from '../light.js';
import { coverCrop, nearArena } from '../arena.js';

const CW = 48, CH = 24; // chunk size in cells

export function createCanvasRenderer() {
  let canvas, ctx, m, dpr = 1, viewW = 0, viewH = 0, map, darkRoomIndex = -1, tints = [];
  const chunks = new Map();
  const bitmaps = new Map();
  const requested = new Set();
  const onLoad = new Set();
  let lightCv = null, glowCv = null;
  let bakedMode = null; // chunks are baked for one view: the arena's inside differs top-down and side-on

  function init(el, theMap) {
    canvas = el;
    map = theMap;
    ctx = canvas.getContext('2d');
    darkRoomIndex = map.rooms.findIndex((r) => r.plan && r.plan.darkroom);
    tints = map.rooms.map(roomTint);
  }

  // Walls aren't inside a room, so take the tint of the room whose rectangle contains the cell.
  function roomNear(x, y) {
    for (let i = 1; i < map.rooms.length; i++) {
      const r = map.rooms[i];
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return i;
    }
    return 0;
  }

  function resize(w, h, ratio) {
    viewW = w; viewH = h; dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    m = cellMetrics(w, h);
    chunks.clear();
    return m;
  }

  const inDark = (x, y) => darkRoomIndex >= 0 && map.roomOf[y * map.W + x] === darkRoomIndex;
  const darkRect = () => map.rooms[darkRoomIndex];
  const inDarkRect = (x, y) => {
    const r = darkRect();
    return r && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
  };

  function cell(c, x, y, fg, bg) {
    if (bg) { c.fillStyle = rgb(...bg); c.fillRect(x * m.cw, y * m.ch, m.cw, m.ch); }
    if (ch !== ' ') { c.fillStyle = rgb(...fg); drawGlyph(c, ch, x * m.cw, y * m.ch, m.cw, m.ch, m.fontPx); }
  }
  // (cell() closes over a mutable `ch` below to avoid allocating strings per call)
  let ch = ' ';
  const put = (c, glyph, x, y, fg, bg) => { ch = glyph; cell(c, x, y, fg, bg); };

  // Draw a frame with its top-left at cell (ox, oy) of context c.
  function drawFrame(c, f, ox, oy, focused) {
    const dark = f.darkroom;
    const border = focused ? C.frameFocus : dark ? C.dFrame : C.frame;
    const x1 = ox + f.w - 1, y1 = oy + f.h - 1;
    for (let x = ox; x <= x1; x++) {
      put(c, x === ox ? '┌' : x === x1 ? '┐' : dark && (x === ox + 1 || x === x1 - 1) ? '╥' : '─', x, oy, border, C.bg);
      put(c, x === ox ? '└' : x === x1 ? '┘' : '─', x, y1, border, C.bg);
    }
    for (let y = oy + 1; y < y1; y++) { put(c, '│', ox, y, border, C.bg); put(c, '│', x1, y, border, C.bg); }
    const bmp = bitmaps.get(f.id);
    const cells = bmp ? cellsFor(f.photo, f.cols, f.rows, dark, bmp) : null;
    for (let y = 0; y < f.rows; y++) {
      for (let x = 0; x < f.cols; x++) {
        const k = y * f.cols + x;
        if (cells) {
          put(c, RAMP[cells.glyph[k]], ox + 1 + x, oy + 1 + y, cells.fg.subarray(k * 3, k * 3 + 3), cells.bg.subarray(k * 3, k * 3 + 3));
        } else if (hasFailed(f.id)) {
          put(c, (x + y) % 2 ? '?' : ' ', ox + 1 + x, oy + 1 + y, C.plaque, C.bg);
        } else {
          put(c, (x + y * 3) % 7 ? ' ' : '·', ox + 1 + x, oy + 1 + y, C.floorDot, C.bg);
        }
      }
    }
  }

  function bake(ix, iy) {
    const cv = new OffscreenCanvas(Math.ceil(CW * m.cw * dpr), Math.ceil(CH * m.ch * dpr));
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    prepareText(c, m.font);
    c.fillStyle = rgb(...C.bg);
    c.fillRect(0, 0, CW * m.cw, CH * m.ch);
    const x0 = ix * CW, y0 = iy * CH;
    for (let y = 0; y < CH; y++) {
      const wy = y0 + y;
      if (wy < 0 || wy >= map.H) continue;
      for (let x = 0; x < CW; x++) {
        const wx = x0 + x;
        if (wx < 0 || wx >= map.W) continue;
        const i = wy * map.W + wx;
        const t = map.tiles[i];
        const dark = inDarkRect(wx, wy);
        if (t === T.WALL) put(c, '#', x, y, dark ? C.dWall : (tints[roomNear(wx, wy)] || C).wall || C.wall, dark ? C.dWallBg : C.wallBg);
        else if (t === T.FLOOR || t === T.DOOR) {
          if ((wx * 7 + wy * 13) % 17 === 0) put(c, '·', x, y, dark || inDark(wx, wy) ? C.dFloorDot : (tints[map.roomOf[i]] || C).dot || C.floorDot);
        } else if (t === T.PROP) {
          const g = map.glyphs.get(i);
          if (g) put(c, g.ch, x, y, C.prop);
        }
      }
    }
    if (bakedMode === 'side' && map.arena) bakeArena(c, x0, y0);
    const visible = (x, y, w, h) => x < x0 + CW && x + w > x0 && y < y0 + CH && y + h > y0;
    for (const l of map.lines) {
      if (!visible(l.x, l.y, l.w, 1)) continue;
      for (let k = 0; k < l.w; k++) put(c, '─', l.x + k - x0, l.y - y0, C.dLine);
    }
    for (const l of map.labels) {
      if (!visible(l.x, l.y, l.text.length, 1)) continue;
      const col = l.role === 'title' ? tints[l.room].title : LABEL_COLOR[l.role] || C.sign;
      [...l.text].forEach((g, k) => put(c, g, l.x + k - x0, l.y - y0, col));
    }
    for (const f of map.frames) {
      if (f.backdrop) continue;
      if (!visible(f.x, f.y, f.w, f.h + 1)) continue;
      if (!f.darkroom) drawFrame(c, f, f.x - x0, f.y - y0, false);
      [...f.plaque.text].forEach((g, k) => put(c, g, f.plaque.x + k - x0, f.plaque.y - y0, f.darkroom ? C.dFrame : C.plaque));
    }
    return cv;
  }

  // Side view: the arena's photo over the whole back wall (the photograph itself, cropped to the room's
  // shape; this chunk draws its own slice of it), and the level's platforms on top.
  function bakeArena(c, x0, y0) {
    const a = map.arena, f = a.backdrop;
    const bmp = f && bitmaps.get(f.id);
    const ix0 = Math.max(x0, a.x + 1), ix1 = Math.min(x0 + CW, a.x + 1 + a.cols);
    const iy0 = Math.max(y0, a.y + 1), iy1 = Math.min(y0 + CH, a.y + 1 + a.rows);
    if (ix0 >= ix1 || iy0 >= iy1) return;
    if (bmp) {
      const cr = coverCrop(bmp.width, bmp.height, a.cols, a.rows);
      const kx = cr.sw / a.cols, ky = cr.sh / a.rows;
      c.imageSmoothingEnabled = true;
      c.imageSmoothingQuality = 'high';
      c.drawImage(bmp, cr.sx + (ix0 - a.x - 1) * kx, cr.sy + (iy0 - a.y - 1) * ky, (ix1 - ix0) * kx, (iy1 - iy0) * ky,
        (ix0 - x0) * m.cw, (iy0 - y0) * m.ch, (ix1 - ix0) * m.cw, (iy1 - iy0) * m.ch);
    }
    for (let y = iy0 - y0; y < iy1 - y0; y++) {
      const ay = y0 + y - a.y - 1;
      for (let x = ix0 - x0; x < ix1 - x0; x++) {
        const ax = x0 + x - a.x - 1;
        if (!bmp && f && hasFailed(f.id)) put(c, (ax + ay) % 2 ? '?' : ' ', x, y, C.plaque, C.bg); // as a print that failed
      }
    }
  }

  function invalidateFrame(f) {
    for (let iy = Math.floor(f.y / CH); iy <= Math.floor((f.y + f.h) / CH); iy++)
      for (let ix = Math.floor(f.x / CW); ix <= Math.floor((f.x + f.w) / CW); ix++) chunks.delete(`${ix},${iy}`);
  }

  function request(f) {
    if (requested.has(f.id)) return;
    requested.add(f.id);
    loadImage(f.photo, f.backdrop ? 'hi' : 'low').then((bmp) => { bitmaps.set(f.id, bmp); invalidateFrame(f); onLoad.forEach((cb) => cb(f)); },
      () => invalidateFrame(f));
  }

  function draw(world) {
    if (!m) return;
    if (world.mode !== bakedMode) { bakedMode = world.mode; chunks.clear(); }
    const cols = viewW / m.cw, rows = viewH / m.ch;
    const left = world.cam.x - cols / 2, top = world.cam.y - rows / 2;
    const sx = (cx) => Math.round((cx - left) * m.cw * dpr) / dpr;
    const sy = (cy) => Math.round((cy - top) * m.ch * dpr) / dpr;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = rgb(...C.bg);
    ctx.fillRect(0, 0, viewW, viewH);

    const ix0 = Math.floor(left / CW), ix1 = Math.floor((left + cols) / CW);
    const iy0 = Math.floor(top / CH), iy1 = Math.floor((top + rows) / CH);
    for (let iy = iy0; iy <= iy1; iy++) {
      for (let ix = ix0; ix <= ix1; ix++) {
        const key = `${ix},${iy}`;
        let cv = chunks.get(key);
        if (!cv) { cv = bake(ix, iy); chunks.set(key, cv); }
        ctx.drawImage(cv, sx(ix * CW), sy(iy * CH), CW * m.cw, CH * m.ch);
      }
    }
    // Forget chunks that are well off screen
    for (const key of chunks.keys()) {
      const [ix, iy] = key.split(',').map(Number);
      if (ix < ix0 - 2 || ix > ix1 + 2 || iy < iy0 - 2 || iy > iy1 + 2) chunks.delete(key);
    }

    // Load photos within about a screen of the view
    // The arena's backdrop is a large image: only once you're near it.
    const arenaNear = world.mode === 'side' || !!world.want || nearArena(map, world.player);
    for (const f of map.frames) {
      if (f.backdrop && !arenaNear) continue;
      if (f.x < left + cols * 2 && f.x + f.w > left - cols && f.y < top + rows * 2 && f.y + f.h > top - rows) request(f);
    }

    // Dynamic layer: work in cell coordinates relative to the view origin
    ctx.save();
    ctx.translate(sx(0), sy(0));
    prepareText(ctx, m.font);
    for (const f of map.frames) {
      if (!f.darkroom) continue;
      if (f.x > left + cols || f.x + f.w < left || f.y > top + rows || f.y + f.h < top) continue;
      const sway = world.reducedMotion ? 0 : Math.sin(world.t * (2 * Math.PI) / (4 + 3 * f.sway) + f.sway * 6.28) * 0.3;
      ctx.save();
      ctx.translate(sway * m.cw, 0);
      drawFrame(ctx, f, f.x, f.y, world.focus === f);
      ctx.restore();
    }
    // Visitors are drawn under the lighting, so they fall into shadow like everything else.
    for (const e of world.people || []) {
      ctx.fillStyle = rgb(...e.color);
      drawGlyph(ctx, e.glyph, (e.x - 0.5) * m.cw, (e.y - 0.5) * m.ch, m.cw, m.ch, m.fontPx);
    }

    // Lighting: one pixel per cell, smoothed up to the grid and multiplied over everything drawn so
    // far; the lantern adds a faint warm haze on top.
    if (world.lighting) {
      const wx = Math.floor(left) - 1, wy = Math.floor(top) - 1;
      const ww = Math.ceil(cols) + 3, wh = Math.ceil(rows) + 3;
      const p = world.player;
      const { rgba, glow } = lightWindow(world.lighting, wx, wy, ww, wh, p, world.t, !world.reducedMotion);
      if (!lightCv || lightCv.width !== ww || lightCv.height !== wh) {
        lightCv = new OffscreenCanvas(ww, wh);
        glowCv = new OffscreenCanvas(ww, wh);
      }
      lightCv.getContext('2d').putImageData(new ImageData(rgba, ww, wh), 0, 0);
      glowCv.getContext('2d').putImageData(new ImageData(glow, ww, wh), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.globalCompositeOperation = 'multiply';
      ctx.drawImage(lightCv, wx * m.cw, wy * m.ch, ww * m.cw, wh * m.ch);
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(glowCv, wx * m.cw, wy * m.ch, ww * m.cw, wh * m.ch);
      ctx.globalCompositeOperation = 'source-over';
    }

    const fo = world.focus;
    if (fo && !fo.darkroom && !fo.backdrop) {
      ctx.fillStyle = rgb(...C.frameFocus);
      const x1 = fo.x + fo.w - 1, y1 = fo.y + fo.h - 1;
      for (let x = fo.x; x <= x1; x++) {
        put(ctx, x === fo.x ? '┌' : x === x1 ? '┐' : '─', x, fo.y, C.frameFocus, C.bg);
        put(ctx, x === fo.x ? '└' : x === x1 ? '┘' : '─', x, y1, C.frameFocus, C.bg);
      }
      for (let y = fo.y + 1; y < y1; y++) { put(ctx, '│', fo.x, y, C.frameFocus, C.bg); put(ctx, '│', x1, y, C.frameFocus, C.bg); }
    }
    // The arena's platforms, over the light at full brightness (box shapes: a couple of rects each). No
    // background, so the photo shows through; a dark copy just below reads on a white wall too.
    if (world.mode === 'side' && map.arena) {
      const a = map.arena;
      const c0 = Math.max(0, Math.floor(left) - a.x - 1), c1 = Math.min(a.cols, Math.ceil(left + cols) - a.x);
      const r0 = Math.max(0, Math.floor(top) - a.y - 1), r1 = Math.min(a.rows, Math.ceil(top + rows) - a.y);
      for (const [color, dy] of [[C.platformShadow, 0.09], [C.platform, 0]]) {
        ctx.fillStyle = rgb(...color);
        for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
          const kind = a.level.cells[r * a.cols + c];
          if (kind) drawGlyph(ctx, kind === 1 ? '═' : '▓', (a.x + 1 + c) * m.cw, (a.y + 1 + r + dy) * m.ch, m.cw, m.ch, m.fontPx);
        }
      }
    }
    for (const e of world.entities || []) {
      ctx.save();
      ctx.translate((e.x - 0.5) * m.cw, (e.y - 0.5) * m.ch);
      ctx.fillStyle = rgb(...C.bg);
      ctx.fillRect(m.cw * 0.1, m.ch * 0.1, m.cw * 0.8, m.ch * 0.8);
      ctx.fillStyle = rgb(...e.color);
      drawGlyph(ctx, e.glyph, 0, 0, m.cw, m.ch, m.fontPx);
      ctx.restore();
    }
    ctx.restore();
  }

  // Screen point → cell
  function cellAt(world, px, py) {
    const cols = viewW / m.cw, rows = viewH / m.ch;
    return { x: Math.floor(world.cam.x - cols / 2 + px / m.cw), y: Math.floor(world.cam.y - rows / 2 + py / m.ch) };
  }

  function dispose() {
    chunks.clear();
    ctx = null;
  }

  return { name: 'canvas', init, resize, draw, dispose, cellAt, onLoad, get metrics() { return m; } };
}
