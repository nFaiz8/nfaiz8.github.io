// Renderer C: draw a plain top-down scene into an offscreen buffer, then turn every cell of it into a
// character in a shader. Labels, plaques, frame borders and people are drawn on top as exact glyphs.
import { cellMetrics, drawGlyph, prepareText, FONT_FAMILY } from './glyphs.js';
import { C, LABEL_COLOR, roomTint } from './palette.js';
import { RAMP } from '../ascii.js';
import { T } from '../layout.js';
import { loadImage, rangeOf } from '../photos.js';
import { lightWindow } from '../light.js';
import { coverCrop, nearArena, blockGlyph } from '../arena.js';
import * as S from './shaders.js';

const SX = 4, SY = 8; // scene texels per cell
const FLOATS = 10; // per glyph instance: x, y, glyph, fg rgb, bg rgba
const FIG_FLOATS = 7; // per figure instance: x, y, glyph, r, g, b, a
const FIG_EXTRA = '═╦╤°♥★…'; // figure and label glyphs beyond printable ASCII

export function createGlRenderer() {
  let canvas, gl, map, m, dpr = 1, viewW = 0, viewH = 0, lost = false;
  let progs, quadVao, glyphVao, instBuf, tilesTex, atlasTex, atlas, sceneTex, sceneFbo, sceneSize = [0, 0];
  let staticGlyphs = new Float32Array(0), dynamic = [];
  let arenaGlyphs = new Float32Array(0); // the arena's platforms, drawn only in its side view
  const photoTex = new Map(); // id → { tex, range, uv }
  const requested = new Set();
  const onLoad = new Set();
  let darkRoomIndex = -1;
  let lightTex, glowTex;
  let figVao, figBuf, figAtlasTex = null, figAtlas = null, figData = new Float32Array(0);

  function compile(vs, fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'a_pos');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = new Proxy({}, { get: (c, k) => (k in c ? c[k] : (c[k] = gl.getUniformLocation(p, k))) });
    return { p, u };
  }

  function init(el, theMap) {
    canvas = el;
    map = theMap;
    gl = canvas.getContext('webgl2', { antialias: false, alpha: false, premultipliedAlpha: true });
    if (!gl) throw new Error('WebGL2 is not available');
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    darkRoomIndex = map.rooms.findIndex((r) => r.plan && r.plan.darkroom);
    progs = {
      tiles: compile(S.TILES_VS, S.TILES_FS),
      photo: compile(S.PHOTO_VS, S.PHOTO_FS),
      ascii: compile(S.ASCII_VS, S.ASCII_FS),
      glyph: compile(S.GLYPH_VS, S.GLYPH_FS),
      light: compile(S.ASCII_VS, S.LIGHT_FS),
      backdrop: compile(S.BACKDROP_VS, S.BACKDROP_FS),
      figure: compile(S.FIGURE_VS, S.FIGURE_FS),
    };

    // Full-screen triangle (tiles, ascii) — attribute 0
    quadVao = gl.createVertexArray();
    gl.bindVertexArray(quadVao);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Unit quad for photos and glyph instances
    glyphVao = gl.createVertexArray();
    gl.bindVertexArray(glyphVao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
    const gp = progs.glyph.p;
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(gp, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr('i_cell', 3, 0);
    attr('i_fg', 3, 3);
    attr('i_bg', 4, 6);

    // The figure layer: the same unit quad, its own instance buffer and layout.
    figVao = gl.createVertexArray();
    gl.bindVertexArray(figVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    figBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, figBuf);
    const fp = progs.figure.p;
    for (const [name, size, offset] of [['i_cell', 3, 0], ['i_color', 4, 3]]) {
      const loc = gl.getAttribLocation(fp, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, FIG_FLOATS * 4, offset * 4);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);

    buildTiles();
    lightTex = gl.createTexture();
    glowTex = gl.createTexture();
  }

  // One texel per world cell: rgb = colour, a = brightness used to pick the glyph.
  function buildTiles() {
    const tints = map.rooms.map(roomTint);
    const data = new Uint8Array(map.W * map.H * 4);
    const dark = map.rooms[darkRoomIndex];
    const inDark = (x, y) => dark && x >= dark.x && x < dark.x + dark.w && y >= dark.y && y < dark.y + dark.h;
    const roomNear = (x, y) => map.rooms.findIndex((r, i) => i > 0 && x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
    for (let y = 0; y < map.H; y++) {
      for (let x = 0; x < map.W; x++) {
        const i = y * map.W + x;
        const t = map.tiles[i];
        let col = C.bg, a = 0;
        if (t === T.WALL) {
          col = inDark(x, y) ? C.dWall : (tints[roomNear(x, y)] || tints[0]).wall;
          a = 0.72;
        } else if (t === T.FLOOR || t === T.DOOR || t === T.PROP) {
          const r = map.roomOf[i];
          col = inDark(x, y) ? [20, 4, 4] : r > 0 ? tints[r].dot.map((v) => v * 0.45) : [12, 13, 17];
          // A faint scatter of dots on the floor, like renderer A
          a = t !== T.PROP && (x * 7 + y * 13) % 17 === 0 ? 0.12 : 0; // not under props (the lobby kiosk)
          if (a) col = inDark(x, y) ? C.dFloorDot : r > 0 ? tints[r].dot : C.floorDot;
        }
        data.set([col[0], col[1], col[2], Math.round(a * 0.49 * 255)], i * 4); // tiles use alpha < 0.5, photos ≥ 0.5
      }
    }
    tilesTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tilesTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, map.W, map.H, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    setFilter(gl.NEAREST, gl.NEAREST);
  }

  function setFilter(min, mag) {
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, min);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, mag);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  // Every glyph we will ever draw, rendered white at device resolution.
  function buildAtlas() {
    const chars = new Set(RAMP);
    const add = (s) => { for (const c of s) chars.add(c); };
    add('@☺☻&·?…─│┌┐└┘╥═║░▒▓█');
    // Names and emotes of real visitors: any printable ASCII, plus the emote symbols.
    for (let c = 32; c < 127; c++) chars.add(String.fromCharCode(c));
    add('♥★');
    map.labels.forEach((l) => add(l.text));
    map.frames.forEach((f) => add(f.plaque.text));
    map.glyphs.forEach((g) => add(g.ch));
    const list = [...chars];
    const cols = 32, rows = Math.ceil(list.length / cols);
    const gw = Math.round(m.cw * dpr), gh = Math.round(m.ch * dpr);
    const cv = new OffscreenCanvas(cols * gw, rows * gh);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    prepareText(c, m.font);
    c.fillStyle = '#fff';
    list.forEach((ch, i) => drawGlyph(c, ch, (i % cols) * m.cw, Math.floor(i / cols) * m.ch, m.cw, m.ch, m.fontPx));
    if (atlasTex) gl.deleteTexture(atlasTex);
    atlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    setFilter(gl.NEAREST, gl.NEAREST);
    atlas = { index: new Map(list.map((ch, i) => [ch, i])), cols, rows };
  }

  const gi = (ch) => atlas.index.get(ch) ?? atlas.index.get('?');

  // The figure atlas: printable ASCII plus the gun and label extras, bold (figures) and regular (labels),
  // each as its fill and as its outline (the glyph dilated by the outline radius o). A slot is a cell plus
  // o on every side, at device resolution. LINEAR, unlike the main atlas.
  function buildFigureAtlas() {
    const list = [];
    for (let c = 32; c < 127; c++) list.push(String.fromCharCode(c));
    list.push(...FIG_EXTRA);
    const n = list.length, cols = 32, rows = Math.ceil((4 * n) / cols);
    const o = Math.max(2, Math.round(0.14 * m.cw * dpr)), w = Math.round(m.cw * dpr), h = Math.round(m.ch * dpr);
    const sw = w + 2 * o, sh = h + 2 * o;
    const cv = new OffscreenCanvas(cols * sw, rows * sh);
    const c = cv.getContext('2d');
    c.fillStyle = c.strokeStyle = '#fff';
    const at = (k) => [(k % cols) * sw + o + w / 2, Math.floor(k / cols) * sh + o + h / 2 + m.fontPx * dpr * 0.05];
    // Slots: [bold fills][regular fills][bold outlines][regular outlines]
    for (const bold of [true, false]) {
      prepareText(c, `${bold ? 'bold ' : ''}${m.fontPx * dpr}px ${FONT_FAMILY}`);
      c.lineJoin = 'round';
      c.lineWidth = 2 * o;
      list.forEach((ch, i) => {
        const k = (bold ? 0 : n) + i;
        const [x, y] = at(k);
        c.fillText(ch, x, y);
        const [ox, oy] = at(k + 2 * n);
        c.strokeText(ch, ox, oy);
        c.fillText(ch, ox, oy);
      });
    }
    if (figAtlasTex) gl.deleteTexture(figAtlasTex);
    figAtlasTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, figAtlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    setFilter(gl.LINEAR, gl.LINEAR);
    figAtlas = { index: new Map(list.map((ch, i) => [ch, i])), n, cols, rows, slot: [sw, sh] };
  }

  const figGlyph = (ch, bold) => (figAtlas.index.get(ch) ?? figAtlas.index.get('?')) + (bold ? 0 : figAtlas.n);

  // The figure layer (side view), over everything else: all the outlines (and chat strips) in list order,
  // then all the fills.
  function drawFigures(list, vx, vy) {
    if (!list.length || !figAtlas) return;
    if (figData.length < list.length * FIG_FLOATS) figData = new Float32Array(list.length * FIG_FLOATS * 2);
    let k = 0;
    for (const g of list) {
      if (!(g.a > 0)) continue;
      figData[k++] = g.x;
      figData[k++] = g.y;
      figData[k++] = g.strip ? -1 : figGlyph(g.ch, g.bold);
      figData[k++] = g.color[0] / 255;
      figData[k++] = g.color[1] / 255;
      figData[k++] = g.color[2] / 255;
      figData[k++] = Math.min(1, g.a);
    }
    if (!k) return;
    const pf = progs.figure;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(pf.p);
    gl.bindVertexArray(figVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, figBuf);
    gl.bufferData(gl.ARRAY_BUFFER, figData.subarray(0, k), gl.STREAM_DRAW);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, figAtlasTex);
    gl.uniform1i(pf.u.u_atlas, 1);
    gl.uniform2f(pf.u.u_view, vx, vy);
    gl.uniform2f(pf.u.u_cellPx, m.cw * dpr, m.ch * dpr);
    gl.uniform2f(pf.u.u_slotPx, figAtlas.slot[0], figAtlas.slot[1]);
    gl.uniform2f(pf.u.u_canvas, canvas.width, canvas.height);
    gl.uniform1f(pf.u.u_atlasCols, figAtlas.cols);
    gl.uniform2f(pf.u.u_atlasGlyphs, figAtlas.cols, figAtlas.rows);
    for (const pass of [0, 1]) {
      gl.uniform1f(pf.u.u_pass, pass);
      gl.uniform1f(pf.u.u_outlineAt, pass ? 0 : 2 * figAtlas.n);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, k / FIG_FLOATS);
    }
  }

  function pushGlyph(out, x, y, ch, fg, bg = null) {
    out.push(x, y, gi(ch), fg[0] / 255, fg[1] / 255, fg[2] / 255,
      bg ? bg[0] / 255 : 0, bg ? bg[1] / 255 : 0, bg ? bg[2] / 255 : 0, bg ? 1 : 0);
  }

  function pushBorder(out, f, color, dx = 0) {
    const x1 = f.x + f.w - 1, y1 = f.y + f.h - 1;
    for (let x = f.x; x <= x1; x++) {
      const top = x === f.x ? '┌' : x === x1 ? '┐' : f.darkroom && (x === f.x + 1 || x === x1 - 1) ? '╥' : '─';
      pushGlyph(out, x + dx, f.y, top, color, C.bg);
      pushGlyph(out, x + dx, y1, x === f.x ? '└' : x === x1 ? '┘' : '─', color, C.bg);
    }
    for (let y = f.y + 1; y < y1; y++) { pushGlyph(out, f.x + dx, y, '│', color, C.bg); pushGlyph(out, x1 + dx, y, '│', color, C.bg); }
  }

  // Labels, plaques, still frame borders, clotheslines and props never move: build them once.
  function buildStaticGlyphs() {
    const tints = map.rooms.map(roomTint);
    const out = [];
    for (const l of map.lines) for (let k = 0; k < l.w; k++) pushGlyph(out, l.x + k, l.y, '─', C.dLine);
    for (const [i, g] of map.glyphs) pushGlyph(out, i % map.W, Math.floor(i / map.W), g.ch, C.prop);
    for (const l of map.labels) {
      const col = l.role === 'title' ? tints[l.room].title : LABEL_COLOR[l.role] || C.sign;
      [...l.text].forEach((ch, k) => ch !== ' ' && pushGlyph(out, l.x + k, l.y, ch, col));
    }
    for (const f of map.frames) {
      if (!f.darkroom && !f.backdrop) pushBorder(out, f, C.frame);
      [...f.plaque.text].forEach((ch, k) => ch !== ' ' && pushGlyph(out, f.plaque.x + k, f.plaque.y, ch, f.darkroom ? C.dFrame : C.plaque));
    }
    staticGlyphs = new Float32Array(out);
    const a = map.arena, plat = [];
    if (a) for (let k = 0; k < a.cols * a.rows; k++) {
      const kind = a.level.cells[k];
      if (!kind) continue;
      // No background, so the photo shows through; a dark copy just below reads on a white wall too.
      const x = a.x + 1 + (k % a.cols), y = a.y + 1 + Math.floor(k / a.cols);
      const g = kind === 1 ? '═' : blockGlyph(a.level, k % a.cols, Math.floor(k / a.cols));
      if (!g) continue;
      pushGlyph(plat, x, y + 0.09, g, C.platformShadow);
      pushGlyph(plat, x, y, g, C.platform);
    }
    arenaGlyphs = new Float32Array(plat);
  }

  function resize(w, h, ratio) {
    viewW = w; viewH = h; dpr = ratio;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    m = cellMetrics(w, h);
    buildAtlas();
    buildFigureAtlas();
    buildStaticGlyphs();
    // Scene covers the view plus a cell of margin on each side
    const cells = [Math.ceil(w / m.cw) + 3, Math.ceil(h / m.ch) + 3];
    if (cells[0] !== sceneSize[0] || cells[1] !== sceneSize[1]) {
      sceneSize = cells;
      if (sceneTex) { gl.deleteTexture(sceneTex); gl.deleteFramebuffer(sceneFbo); }
      sceneTex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      const levels = 1 + Math.floor(Math.log2(Math.max(cells[0] * SX, cells[1] * SY)));
      gl.texStorage2D(gl.TEXTURE_2D, levels, gl.RGBA8, cells[0] * SX, cells[1] * SY);
      setFilter(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
      sceneFbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, sceneTex, 0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    return m;
  }

  function request(f) {
    if (requested.has(f.id)) return;
    requested.add(f.id);
    loadImage(f.photo, f.backdrop ? 'hi' : 'low').then((bmp) => {
      if (!gl || lost) return;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
      gl.generateMipmap(gl.TEXTURE_2D);
      setFilter(gl.LINEAR_MIPMAP_LINEAR, gl.LINEAR);
      const r = rangeOf(f.photo, bmp);
      const crop = f.backdrop ? coverCrop(bmp.width, bmp.height, f.cols, f.rows) : null;
      const uv = crop ? [crop.sx / bmp.width, crop.sy / bmp.height, crop.sw / bmp.width, crop.sh / bmp.height] : [0, 0, 1, 1];
      photoTex.set(f.id, { tex, range: [r.lo, r.hi], uv });
      onLoad.forEach((cb) => cb(f));
    }, () => {});
  }

  const swayOf = (world, f) => (world.reducedMotion || !f.darkroom ? 0 : Math.sin(world.t * (2 * Math.PI) / (4 + 3 * f.sway) + f.sway * 6.28) * 0.3);

  function draw(world) {
    if (!gl || lost || !m) return;
    const cols = viewW / m.cw, rows = viewH / m.ch;
    const left = world.cam.x - cols / 2, top = world.cam.y - rows / 2;
    // Snap the view to device pixels so glyphs stay sharp while scrolling
    const vx = Math.round(left * m.cw * dpr) / (m.cw * dpr), vy = Math.round(top * m.ch * dpr) / (m.ch * dpr);
    const origin = [Math.floor(vx) - 1, Math.floor(vy) - 1];

    // The arena's backdrop is a large image: only once you're near it.
    const arenaNear = world.mode === 'side' || !!world.want || nearArena(map, world.player);
    for (const f of map.frames) {
      if (f.backdrop && !arenaNear) continue;
      if (f.x < left + cols * 2 && f.x + f.w > left - cols && f.y < top + rows * 2 && f.y + f.h > top - rows) request(f);
    }

    // Pass 1: scene
    gl.bindFramebuffer(gl.FRAMEBUFFER, sceneFbo);
    gl.viewport(0, 0, sceneSize[0] * SX, sceneSize[1] * SY);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(quadVao);
    const pt = progs.tiles;
    gl.useProgram(pt.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tilesTex);
    gl.uniform1i(pt.u.u_tiles, 0);
    gl.uniform2f(pt.u.u_origin, origin[0], origin[1]);
    gl.uniform2f(pt.u.u_cells, sceneSize[0], sceneSize[1]);
    gl.uniform2f(pt.u.u_mapSize, map.W, map.H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.bindVertexArray(glyphVao);
    const pp = progs.photo;
    gl.useProgram(pp.p);
    gl.uniform2f(pp.u.u_origin, origin[0], origin[1]);
    gl.uniform2f(pp.u.u_cells, sceneSize[0], sceneSize[1]);
    gl.uniform1i(pp.u.u_img, 0);
    for (const f of map.frames) {
      const t = photoTex.get(f.id);
      if (!t || f.backdrop) continue; // the arena's photo is drawn as itself, after the ASCII pass
      if (f.x > origin[0] + sceneSize[0] || f.x + f.w < origin[0] || f.y > origin[1] + sceneSize[1] || f.y + f.h < origin[1]) continue;
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
      gl.uniform4f(pp.u.u_rect, f.x + 1 + swayOf(world, f), f.y + 1, f.cols, f.rows);
      gl.uniform2f(pp.u.u_range, t.range[0], t.range[1]);
      gl.uniform1f(pp.u.u_mono, f.darkroom ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.generateMipmap(gl.TEXTURE_2D);

    // Pass 2: ASCII
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.bindVertexArray(quadVao);
    const pa = progs.ascii;
    gl.useProgram(pa.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(pa.u.u_scene, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, atlasTex);
    gl.uniform1i(pa.u.u_atlas, 1);
    gl.uniform2f(pa.u.u_view, vx, vy);
    gl.uniform2f(pa.u.u_cellPx, m.cw * dpr, m.ch * dpr);
    gl.uniform2f(pa.u.u_origin, origin[0], origin[1]);
    gl.uniform1f(pa.u.u_canvasH, canvas.height);
    gl.uniform1f(pa.u.u_atlasCols, atlas.cols);
    gl.uniform2f(pa.u.u_atlasGlyphs, atlas.cols, atlas.rows);
    gl.uniform1fv(pa.u.u_ramp, [...RAMP].map(gi));
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    // Pass 3: exact glyphs. Labels and plaques are lit with the room; the focus border and the people
    // are drawn after the lighting so they stay crisp and readable.
    const pg = progs.glyph;
    const drawGlyphs = (data) => {
      if (!data.length) return;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.useProgram(pg.p);
      gl.bindVertexArray(glyphVao);
      gl.bindBuffer(gl.ARRAY_BUFFER, instBuf);
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, atlasTex);
      gl.uniform1i(pg.u.u_atlas, 1);
      gl.uniform2f(pg.u.u_view, vx, vy);
      gl.uniform2f(pg.u.u_viewCells, canvas.width / (m.cw * dpr), canvas.height / (m.ch * dpr));
      gl.uniform1f(pg.u.u_atlasCols, atlas.cols);
      gl.uniform2f(pg.u.u_atlasGlyphs, atlas.cols, atlas.rows);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, data.length / FLOATS);
    };
    // Side view: the arena's photo over its back wall, then its platforms (both lit with the room below).
    const bd = world.mode === 'side' && map.arena && map.arena.backdrop;
    const bt = bd && photoTex.get(bd.id);
    if (bt) {
      const pb = progs.backdrop;
      gl.disable(gl.BLEND);
      gl.useProgram(pb.p);
      gl.bindVertexArray(glyphVao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, bt.tex);
      gl.uniform1i(pb.u.u_img, 0);
      gl.uniform4f(pb.u.u_rect, bd.x + 1, bd.y + 1, bd.cols, bd.rows);
      gl.uniform4f(pb.u.u_uv, bt.uv[0], bt.uv[1], bt.uv[2], bt.uv[3]);
      gl.uniform2f(pb.u.u_view, vx, vy);
      gl.uniform2f(pb.u.u_viewCells, canvas.width / (m.cw * dpr), canvas.height / (m.ch * dpr));
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
    drawGlyphs(staticGlyphs);
    const people = [];
    for (const e of world.people || []) pushGlyph(people, e.x - 0.5, e.y - 0.5, e.glyph, e.color);
    drawGlyphs(new Float32Array(people));

    if (world.lighting) {
      const wx = Math.floor(left) - 1, wy = Math.floor(top) - 1;
      const ww = Math.ceil(cols) + 3, wh = Math.ceil(rows) + 3;
      const { rgba, glow } = lightWindow(world.lighting, wx, wy, ww, wh, world.player, world.t, !world.reducedMotion);
      const pl = progs.light;
      gl.useProgram(pl.p);
      gl.bindVertexArray(quadVao);
      gl.uniform2f(pl.u.u_view, vx, vy);
      gl.uniform2f(pl.u.u_cellPx, m.cw * dpr, m.ch * dpr);
      gl.uniform2f(pl.u.u_lorigin, wx, wy);
      gl.uniform2f(pl.u.u_lsize, ww, wh);
      gl.uniform1f(pl.u.u_canvasH, canvas.height);
      gl.uniform1i(pl.u.u_light, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.enable(gl.BLEND);
      for (const [tex, data, src, dst] of [[lightTex, rgba, gl.DST_COLOR, gl.ZERO], [glowTex, glow, gl.ONE, gl.ONE]]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, ww, wh, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        setFilter(gl.LINEAR, gl.LINEAR);
        gl.blendFunc(src, dst);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
    }

    dynamic.length = 0;
    for (const f of map.frames) {
      if (!f.darkroom || f.x > left + cols || f.x + f.w < left || f.y > top + rows || f.y + f.h < top) continue;
      pushBorder(dynamic, f, world.focus === f ? C.frameFocus : C.dFrame, swayOf(world, f));
    }
    if (world.focus && !world.focus.darkroom && !world.focus.backdrop) pushBorder(dynamic, world.focus, C.frameFocus);
    for (const e of world.entities || []) pushGlyph(dynamic, e.x - 0.5, e.y - 0.5, e.glyph, e.color, C.bg);
    if (world.mode === 'side') drawGlyphs(arenaGlyphs); // platforms over the light, at full brightness
    drawGlyphs(new Float32Array(dynamic));
    drawFigures(world.figures || [], vx, vy);
    gl.bindVertexArray(null);
  }

  function cellAt(world, px, py) {
    const cols = viewW / m.cw, rows = viewH / m.ch;
    return { x: Math.floor(world.cam.x - cols / 2 + px / m.cw), y: Math.floor(world.cam.y - rows / 2 + py / m.ch) };
  }

  // Screen point → map position in fractional cells
  function pointAt(world, px, py) {
    const cols = viewW / m.cw, rows = viewH / m.ch;
    return { x: world.cam.x - cols / 2 + px / m.cw, y: world.cam.y - rows / 2 + py / m.ch };
  }

  function dispose() {
    if (gl && !lost) {
      if (figAtlasTex) gl.deleteTexture(figAtlasTex);
      photoTex.forEach((t) => gl.deleteTexture(t.tex));
      gl.deleteTexture(lightTex);
      gl.deleteTexture(glowTex);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    photoTex.clear();
    gl = null;
  }

  return { name: 'gl', init, resize, draw, dispose, cellAt, pointAt, onLoad, get lost() { return lost; }, get metrics() { return m; } };
}
