// Renderer A: every cell is drawn as a character on a 2D canvas. Static things (walls, floor, labels,
// still photos) are baked into chunk canvases; each frame only blits them and draws what moves.
// The arena is the train (src/train.js): its glyphs are stamped white from an atlas, coloured cell by cell
// in one composite, over its backgrounds, and its glow is added on top. The side view has its own cell
// size (the zoom).
import { cellMetrics, sideMetrics, drawGlyph, prepareText, rgb, FONT_FAMILY } from './glyphs.js';
import { C, LABEL_COLOR, roomTint } from './palette.js';
import { RAMP } from '../ascii.js';
import { T } from '../layout.js';
import { loadImage, cellsFor, hasFailed } from '../photos.js';
import { lightWindow } from '../light.js';
import { paintWindow, halation, TRAIN_GLYPHS } from '../train.js';

const CW = 48, CH = 24; // chunk size in cells

// The figure layer's sprites are keyed by colour, so a long visit sees many. Past the cap the cache starts
// over (30 people need well under 2,000: about 25 figure glyphs per colour plus the shared label colours).
export const SPRITE_CAP = 2000;
export function createSpriteCache(cap = SPRITE_CAP) {
  const map = new Map();
  return {
    get: (key) => map.get(key),
    set(key, value) {
      if (map.size >= cap) map.clear();
      map.set(key, value);
      return value;
    },
    clear: () => map.clear(),
    get size() { return map.size; },
  };
}

export function createCanvasRenderer() {
  let canvas, ctx, m, dpr = 1, viewW = 0, viewH = 0, map, darkRoomIndex = -1, tints = [];
  // M: the metrics in use (the gallery's m, or the side view's by its zoom); atlasM: the ones the sprites and
  // the train's glyph atlas were drawn at (scaled while the zoom eases, redrawn crisp once it settles).
  let M = null, atlasM = null, zoom = null;
  let trainAtlas = null, trainWin = null, layerCv = null, fgCv = null, bgCv = null, haloCv = null;
  const halo = { a: new Float32Array(0), b: new Float32Array(0) };
  const chunks = new Map();
  const bitmaps = new Map();
  const requested = new Set();
  const onLoad = new Set();
  let lightCv = null, glowCv = null;
  const sprites = createSpriteCache(); // the figure layer's glyphs: 'ch|r,g,b|bold' (fill) or 'ch|outline|bold' → a small canvas

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
    atlasM = null;
    layerCv = null;
    useAtlas(m); // as GL does: while the zoom eases, setView keeps the atlas it has (drawn scaled), so there must be one
    setView(zoom);
    return m;
  }

  // The side view's zoom: { rows, settled } (main.js eases it by the gun in hand), or null top-down.
  function setView(z) {
    zoom = z ? { rows: z.rows, settled: !!z.settled } : null;
    if (!m) return;
    M = zoom ? sideMetrics(viewH, dpr, zoom.rows, zoom.settled) : m;
    if (!zoom || zoom.settled) useAtlas(M);
  }
  function useAtlas(k) {
    if (atlasM && atlasM.cw === k.cw && atlasM.fontPx === k.fontPx) return;
    atlasM = k;
    sprites.clear();
    trainAtlas = null;
  }

  // The train's glyphs, white, one device-pixel cell each at atlasM.
  function buildTrainAtlas() {
    const list = [...new Set(TRAIN_GLYPHS)];
    const cols = 32, gw = Math.round(atlasM.cw * dpr), gh = Math.round(atlasM.ch * dpr);
    const cv = new OffscreenCanvas(cols * gw, Math.ceil(list.length / cols) * gh);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    prepareText(c, atlasM.font);
    c.fillStyle = '#fff';
    list.forEach((g, i) => drawGlyph(c, g, (i % cols) * atlasM.cw, Math.floor(i / cols) * atlasM.ch, atlasM.cw, atlasM.ch, atlasM.fontPx));
    trainAtlas = { cv, cols, gw, gh, index: new Map(list.map((g, i) => [g, i])) };
  }

  // The train (world.train: { T, F, look, glows }) over the level's box. Side-on it fills the view (the
  // tunnel runs on past the room's ends); top-down it is clipped to the room. In device pixels.
  function drawTrain(world, left, top, cols, rows, clip) {
    const tr = world.train, a = map.arena;
    if (!tr || !a) return;
    if (!trainAtlas) buildTrainAtlas();
    const ox = a.x + 1, oy = a.y + 1;
    let x0 = Math.floor(left) - ox - 1, y0 = Math.floor(top) - oy - 1;
    let x1 = x0 + Math.ceil(cols) + 3, y1 = y0 + Math.ceil(rows) + 3;
    if (clip) { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(a.cols, x1); y1 = Math.min(a.rows, y1); }
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0) return;
    trainWin = paintWindow(tr.T, tr.F, tr.look, x0, y0, w, h, trainWin);
    const cwd = M.cw * dpr, chd = M.ch * dpr;
    const X = (cx) => Math.round((cx - left) * cwd), Y = (cy) => Math.round((cy - top) * chd);
    const px0 = X(ox + x0), py0 = Y(oy + y0), pw = X(ox + x1) - px0, ph = Y(oy + y1) - py0;
    // A field canvas keeps its ImageData; the data arrays are reused too (paintWindow, halation), so a frame
    // of the same size makes nothing new.
    const field = (cv, data) => {
      if (!cv || cv.width !== w || cv.height !== h) cv = new OffscreenCanvas(w, h);
      if (!cv.img || cv.img.data !== data) cv.img = new ImageData(data, w, h);
      cv.getContext('2d').putImageData(cv.img, 0, 0);
      return cv;
    };
    bgCv = field(bgCv, trainWin.bg);
    fgCv = field(fgCv, trainWin.fg);
    // The glyphs, white, into a layer the size of the canvas; then coloured in one go by the fg field.
    if (!layerCv || layerCv.width !== canvas.width || layerCv.height !== canvas.height) layerCv = new OffscreenCanvas(canvas.width, canvas.height);
    const lc = layerCv.getContext('2d');
    lc.globalCompositeOperation = 'source-over';
    lc.clearRect(0, 0, layerCv.width, layerCv.height);
    lc.imageSmoothingEnabled = !zoom || !zoom.settled;
    const A = trainAtlas, dw = Math.round(cwd), dh = Math.round(chd);
    for (let y = 0; y < h; y++) {
      const dy = Y(oy + y0 + y);
      for (let x = 0; x < w; x++) {
        const g = trainWin.ch[y * w + x];
        if (g === ' ') continue;
        let i = A.index.get(g);
        if (i === undefined) i = A.index.get('?');
        lc.drawImage(A.cv, (i % A.cols) * A.gw, Math.floor(i / A.cols) * A.gh, A.gw, A.gh, X(ox + x0 + x), dy, dw, dh);
      }
    }
    lc.globalCompositeOperation = 'source-in';
    lc.imageSmoothingEnabled = false;
    lc.drawImage(fgCv, px0, py0, pw, ph);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bgCv, px0, py0, pw, ph);
    ctx.drawImage(layerCv, 0, 0);
    // Halation: emissive cells, tracers and muzzle flashes, blurred and added (only over the train).
    const extra = (tr.glows || []).map((q) => ({ x: q.x - x0, y: q.y - y0, c: q.c }));
    haloCv = field(haloCv, halation(trainWin.glow, w, h, extra, undefined, halo));
    ctx.beginPath();
    ctx.rect(px0, py0, pw, ph);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'lighter';
    // Smoothed from cell centres, as GL's LINEAR does.
    ctx.drawImage(haloCv, px0, py0, pw, ph);
    ctx.restore();
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

  function invalidateFrame(f) {
    for (let iy = Math.floor(f.y / CH); iy <= Math.floor((f.y + f.h) / CH); iy++)
      for (let ix = Math.floor(f.x / CW); ix <= Math.floor((f.x + f.w) / CW); ix++) chunks.delete(`${ix},${iy}`);
  }

  function request(f) {
    if (requested.has(f.id)) return;
    requested.add(f.id);
    loadImage(f.photo, 'low').then((bmp) => { bitmaps.set(f.id, bmp); invalidateFrame(f); onLoad.forEach((cb) => cb(f)); },
      () => invalidateFrame(f));
  }

  function draw(world) {
    if (!m) return;
    if (!M) M = m;
    const side = world.mode === 'side' && !!map.arena;
    const cols = viewW / M.cw, rows = viewH / M.ch;
    const left = world.cam.x - cols / 2, top = world.cam.y - rows / 2;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = rgb(...C.bg);
    ctx.fillRect(0, 0, viewW, viewH);
    if (side) {
      // Side-on the train is the whole view: nothing of the gallery shows.
      drawTrain(world, left, top, cols, rows, false);
    } else drawGallery(world, left, top, cols, rows);

    const sx = (cx) => Math.round((cx - left) * M.cw * dpr) / dpr;
    const sy = (cy) => Math.round((cy - top) * M.ch * dpr) / dpr;
    ctx.save();
    ctx.translate(sx(0), sy(0));
    ctx.scale(M.cw / m.cw, M.ch / m.ch); // entities are drawn in gallery cells
    prepareText(ctx, m.font);
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
    drawFigures(world.figures || [], left, top);
  }

  // The gallery, top-down, at its own cell size m (M is m here).
  function drawGallery(world, left, top, cols, rows) {
    const sx = (cx) => Math.round((cx - left) * m.cw * dpr) / dpr;
    const sy = (cy) => Math.round((cy - top) * m.ch * dpr) / dpr;
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

    // Load photos within about a screen of the view (never the arena's: it is opened by E, and loads then).
    for (const f of map.frames) {
      if (f.backdrop) continue;
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
    ctx.restore();
    // The arena from outside: the train at the gallery's cell size, lit by its own light.
    drawTrain(world, left, top, cols, rows, true);
  }

  // The figure layer (side view): stick figures and their labels, over everything else, in two passes like
  // the GL renderer: every glyph's dark outline (and the chat strips) in list order, then every fill, so a
  // bone's outline never cuts across the bone it joins. Each glyph is a cached sprite with its corner
  // snapped to a device pixel; turned (rot), stretched (len) or flipped ones are drawn through a transform
  // about its centre. o is the outline's radius in device pixels.
  // Sprites are drawn at atlasM; while the zoom eases they are drawn scaled (the outline grows with the zoom).
  const outlinePx = () => Math.max(2, Math.round(0.14 * atlasM.cw * dpr));
  function sprite(glyph, color, bold) {
    const key = color ? `${glyph}|${color[0]},${color[1]},${color[2]}|${bold ? 1 : 0}` : `${glyph}|outline|${bold ? 1 : 0}`;
    let cv = sprites.get(key);
    if (cv) return cv;
    const o = outlinePx(), w = Math.round(atlasM.cw * dpr), h = Math.round(atlasM.ch * dpr);
    cv = new OffscreenCanvas(w + 2 * o, h + 2 * o);
    const c = cv.getContext('2d');
    prepareText(c, `${bold ? 'bold ' : ''}${atlasM.fontPx * dpr}px ${FONT_FAMILY}`);
    const x = o + w / 2, y = o + h / 2 + atlasM.fontPx * dpr * 0.05;
    // Drawn in white, then tinted, as the GL atlas is: text's coverage depends on its colour, and a dark
    // outline drawn as dark text comes out thinner than GL's.
    c.fillStyle = c.strokeStyle = '#fff';
    if (!color) {
      c.lineJoin = 'round';
      c.lineWidth = 2 * o;
      c.strokeText(glyph, x, y);
    }
    c.fillText(glyph, x, y);
    c.globalCompositeOperation = 'source-in';
    c.fillStyle = color ? rgb(...color) : 'rgb(7,8,11)'; // the outline is drawn at 0.9 opacity
    c.fillRect(0, 0, cv.width, cv.height);
    return sprites.set(key, cv);
  }

  function drawFigures(list, left, top) {
    if (!list.length) return;
    const cw = M.cw * dpr, chp = M.ch * dpr, o = outlinePx(), k = M.cw / atlasM.cw;
    const sw = (Math.round(atlasM.cw * dpr) + 2 * o) * k, sh = (Math.round(atlasM.ch * dpr) + 2 * o) * k;
    // Bilinear, like the GL atlas: 'high' would blur a squeezed bone's thin outline grey.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'low';
    for (let pass = 0; pass < 2; pass++) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      for (const g of list) {
        if (!(g.a > 0)) continue;
        const px = (g.x - left) * cw, py = (g.y - top) * chp;
        ctx.globalAlpha = Math.min(1, g.a) * (pass || g.strip ? 1 : 0.9);
        if (g.strip) {
          if (pass) continue;
          const x0 = Math.round(px - cw / 2), y0 = Math.round(py - chp / 2);
          ctx.fillStyle = rgb(...g.color);
          ctx.fillRect(x0, y0, Math.round(px + cw / 2) - x0, Math.round(py + chp / 2) - y0);
          continue;
        }
        // The sprite's corner sits on a device pixel, so upright glyphs (and level bars) stay crisp.
        const img = sprite(g.ch, pass ? g.color : null, g.bold), x0 = Math.round(px - sw / 2), y0 = Math.round(py - sh / 2);
        const rot = g.rot || 0, len = g.len > 0 ? g.len : 1, fx = g.flip ? -1 : 1;
        if (rot === 0 && len === 1 && fx === 1) {
          if (k === 1) ctx.drawImage(img, x0, y0);
          else ctx.drawImage(img, x0, y0, sw, sh);
        } else {
          const c = Math.cos(rot), s = Math.sin(rot);
          ctx.setTransform(c * fx, s * fx, -s * len, c * len, x0 + sw / 2, y0 + sh / 2);
          ctx.drawImage(img, -sw / 2, -sh / 2, sw, sh);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  // Screen point → cell
  function cellAt(world, px, py) {
    const k = M || m, cols = viewW / k.cw, rows = viewH / k.ch;
    return { x: Math.floor(world.cam.x - cols / 2 + px / k.cw), y: Math.floor(world.cam.y - rows / 2 + py / k.ch) };
  }

  // Screen point → map position in fractional cells
  function pointAt(world, px, py) {
    const k = M || m, cols = viewW / k.cw, rows = viewH / k.ch;
    return { x: world.cam.x - cols / 2 + px / k.cw, y: world.cam.y - rows / 2 + py / k.ch };
  }

  function dispose() {
    chunks.clear();
    sprites.clear();
    ctx = null;
  }

  const missing = new Set(); // the canvas draws any glyph the font has; nothing is missing from an atlas
  return { name: 'canvas', init, resize, setView, draw, dispose, cellAt, pointAt, onLoad, missing, get metrics() { return M || m; } };
}
