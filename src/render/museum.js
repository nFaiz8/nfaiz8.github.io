// Renderer C, the museum (the default; same interface as canvas.js and gl.js):
//
//   floors and walls are a faint, regular ASCII texture; their lit ground colour goes into a small image
//   (one pixel per cell) scaled up smoothly behind the glyphs, so light fades instead of stepping;
//   prints keep the site's own cells, with a lamp bar on the wall over each; walls are connected lines;
//   and a little more life: Mochi the cat, Gus the guard with a torch, visitors who talk, dust in the
//   picture lights, rippling darkroom trays, a lamp that's failing.
//
// Inside the arena, the side view and its train are the site's own canvas renderer, unchanged. From outside,
// the arena is just a quiet room with its rails: the train only runs while you're in there.
import { createCanvasRenderer as createSiteRenderer } from './canvas.js';
import { drawGlyph, prepareText, rgb } from './glyphs.js';
import { C } from './palette.js';
import { RAMP } from '../ascii.js';
import { T, CELL_ASPECT, isWalkable } from '../layout.js';
import { loadImage, cellsFor, hasFailed } from '../photos.js';
import { lightWindow } from '../light.js';
import { findPath } from '../path.js';
import { roomAt } from '../world.js';

function hash(a, b = 0) { let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mod = (n, m) => ((n % m) + m) % m;
const mul = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const mix = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}
const qc = (v) => clamp(Math.round(v / 6) * 6, 0, 255);
const css = (c) => rgb(qc(c[0]), qc(c[1]), qc(c[2]));
let seed = 7;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
const pick = (a) => a[Math.floor(rnd() * a.length)];

// How bright the building is: light → shown = (LIFT + GAIN·light) / BRIGHT, never below FLOOR. Prints keep
// their own lamps, so dimming the rooms leaves them the brightest thing in view.
const LIFT = 0.12, GAIN = 0.85, FLOOR = 0.07, HAZE = 0.55, FACE_K = 0.6, WALL_L = 0.42;
const F = { PLAIN: 1, PRINT: 2, EMIS: 4, GLOW: 8, WALL: 16, ISLAND: 32, FACE: 64 };
const LOOK = ['hm.', 'oh.', 'wow', 'the light!', 'is this film?', 'love this one', 'where is this?', '…', 'look at the grain', 'that colour', 'I was here once', 'stunning', 'so quiet in here', 'closer…', 'I want this one'];
const ROOM_LOOK = { dark: ['why is it red?', 'smells like vinegar', 'film!', 'are those drying?'], silver: ['no colour at all', 'just light', 'shh'], warm: ['so warm', 'golden', 'like a sunset'], cool: ['cold', 'blue hour', 'calm'] };

function createMuseumLook(name) {
  const site = createSiteRenderer(); // draws the train and the side view, on the same canvas
  let canvas, ctx, map, W, H, dpr = 1, viewW = 0, viewH = 0;
  let CH, FG, GROUND, FL, WALLM, LAMP_OF, ROOMS, LAMPS, TRAYS, LOBBY;
  const onLoad = new Set();
  const bitmaps = new Map(), requested = new Set();
  const LIGHT = { cv: document.createElement('canvas'), img: null };
  LIGHT.cx = LIGHT.cv.getContext('2d');
  let life = null, lastT = null;

  function init(el, theMap) {
    canvas = el; map = theMap; W = map.W; H = map.H;
    ctx = canvas.getContext('2d');
    site.init(canvas, map);
    build();
  }

  // ---------- the static cells ----------
  function build() {
    const N = W * H, at = (x, y) => y * W + x, inMap = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
    CH = new Array(N).fill(' '); FG = new Float32Array(N * 3); GROUND = new Float32Array(N * 3); FL = new Uint8Array(N);
    WALLM = new Uint8Array(N); LAMP_OF = new Int16Array(N).fill(-1);
    const setFG = (i, c) => { FG[i * 3] = c[0]; FG[i * 3 + 1] = c[1]; FG[i * 3 + 2] = c[2]; };
    const setGround = (i, c) => { GROUND[i * 3] = c[0]; GROUND[i * 3 + 1] = c[1]; GROUND[i * 3 + 2] = c[2]; };
    ROOMS = map.rooms.map((r, i) => {
      const kind = r.arena ? 'arena' : r.plan && r.plan.darkroom ? 'dark' : r.id === 'lobby' ? 'lobby' : r.hue == null ? 'silver' : 'gallery';
      const warm = r.wing === 'north';
      let ground, tex, accent;
      if (kind === 'gallery') { ground = hsl(r.hue, 22, warm ? 15 : 13); tex = mul(ground, warm ? 1.5 : 1.9); accent = hsl(r.hue, 70, 66); }
      else if (kind === 'silver') { ground = [42, 42, 44]; tex = [80, 80, 84]; accent = [220, 222, 228]; }
      else if (kind === 'lobby') { ground = [56, 51, 44]; tex = [90, 83, 72]; accent = [255, 220, 170]; }
      else if (kind === 'dark') { ground = [42, 34, 32]; tex = [70, 58, 54]; accent = [255, 90, 70]; }
      else { ground = [34, 36, 40]; tex = [64, 68, 76]; accent = [140, 200, 255]; }
      return { r, i, kind, warm, ground, tex, accent };
    });
    LOBBY = ROOMS.find((k) => k.kind === 'lobby');
    const COR = { ground: [50, 46, 41], tex: [84, 76, 68] };
    // floors: one ground colour per room, a faint regular texture
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = at(x, y), t = map.tiles[i];
      if (t === T.VOID || t === T.WALL) continue;
      const ri = map.roomOf[i], R = ri >= 0 ? ROOMS[ri] : null, r = R && R.r;
      const h = hash(x, y * 3 + 7);
      let ch = ' ';
      if (!R) ch = h < 0.07 ? (h < 0.025 ? '·' : h < 0.05 ? ',' : "'") : ' ';
      else if (R.kind === 'gallery' && R.warm) ch = (x + (y % 3) * 4) % 12 === 0 ? '╵' : '─';
      else if (R.kind === 'gallery' || R.kind === 'silver') ch = (x + 2 * y) % 4 === 0 ? '·' : ' ';
      else if (R.kind === 'lobby') { const gx = (x - r.x) % 6 === 0, gy = (y - r.y) % 3 === 0; ch = gx && gy ? '┼' : gy ? '─' : gx ? '│' : ' '; }
      else if (R.kind === 'dark') ch = (x + 3 * y) % 6 === 0 ? '.' : ' ';
      else { const cy = r.y + Math.floor(r.h / 2); ch = y === cy - 1 || y === cy + 1 ? '─' : y === cy && (x - r.x) % 3 === 0 ? '┼' : (x + 2 * y) % 6 === 0 ? '·' : ' '; } // the arena: its rails
      CH[i] = ch; setFG(i, R ? R.tex : COR.tex); setGround(i, R ? R.ground : COR.ground); FL[i] = F.PLAIN;
    }
    // walls: connected lines, dark ground
    const isWall = (x, y) => inMap(x, y) && map.tiles[at(x, y)] === T.WALL;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (!isWall(x, y)) continue;
      const i = at(x, y);
      WALLM[i] = (isWall(x, y - 1) ? 1 : 0) | (isWall(x + 1, y) ? 2 : 0) | (isWall(x, y + 1) ? 4 : 0) | (isWall(x - 1, y) ? 8 : 0) | 16;
      FL[i] = F.WALL | F.PLAIN; setGround(i, [22, 21, 20]); setFG(i, [128, 122, 112]);
    }
    // the 3/4 view (restyle-layout.js, ?view=face): wall faces, bands you look at, that the prints hang on;
    // darker toward the top, panel seams, a skirting at the foot, and the floor in front in their shadow
    for (const fc of map.faces || []) {
      const R = ROOMS[fc.room];
      const base = R && R.kind === 'gallery' ? hsl(R.r.hue, 18, R.warm ? 12 : 11) : R && R.kind === 'silver' ? [36, 36, 38] : [48, 44, 38];
      for (let y = fc.y; y < fc.y + fc.h; y++) for (let x = fc.x; x < fc.x + fc.w; x++) {
        const i = at(x, y), k = y - fc.y, last = k === fc.h - 1;
        FL[i] = F.PLAIN | F.FACE;
        setGround(i, mul(base, 0.62 + 0.38 * (k / Math.max(1, fc.h - 1))));
        CH[i] = last ? '▔' : fc.kind !== 'short' && k > 0 && (x - fc.x) % 14 === 0 ? '╎' : ' ';
        setFG(i, last ? mul(base, 2.8) : mul(base, 1.7));
        const j = at(x, y + 1);
        if (last && inMap(x, y + 1) && FL[j] === F.PLAIN) for (let c = 0; c < 3; c++) GROUND[j * 3 + c] *= 0.7;
      }
    }
    // islands (restyle-layout.js): a solid plinth, not two rows of wall lines
    map.rooms.forEach((r) => (r.plan && r.plan.islands || []).forEach((is) => {
      for (let y = r.y + 1 + is.y; y < r.y + 1 + is.y + is.h; y++) for (let x = r.x + 1 + is.x; x < r.x + 1 + is.x + is.w; x++) {
        const i = at(x, y); FL[i] |= F.ISLAND; setGround(i, [40, 37, 33]); setFG(i, [112, 104, 92]);
      }
    }));
    // the site's props: the darkroom bench and trays, the information desk
    for (const [i, g] of map.glyphs) { CH[i] = g.ch; setFG(i, [150, 132, 104]); if (!FL[i]) setGround(i, COR.ground); FL[i] |= F.PLAIN; }
    TRAYS = [...map.glyphs].filter(([, g]) => g.ch === '~').map(([i]) => i);
    // darkroom clotheslines
    for (const ln of map.lines) for (let x = ln.x; x < ln.x + ln.w; x++) { const i = at(x, ln.y); if (FL[i] === F.PLAIN) { CH[i] = '─'; setFG(i, [110, 92, 84]); } }
    // labels: room titles on the floor, the name, signs, the desk
    const ROLE = { name: [255, 236, 200], tagline: [200, 190, 170], about: [170, 160, 140], kiosk: [150, 230, 170], sign: [233, 162, 59], subtitle: [150, 142, 126] };
    for (const l of map.labels) {
      const R = l.room != null ? ROOMS[l.room] : null;
      const col = l.role === 'title' && R ? R.accent : ROLE[l.role] || [200, 200, 200];
      [...l.text].forEach((ch, k) => {
        if (ch === ' ' || !inMap(l.x + k, l.y)) return;
        const i = at(l.x + k, l.y);
        CH[i] = ch; setFG(i, col); if (!FL[i]) { setGround(i, COR.ground); FL[i] = F.PLAIN; }
        if (l.role === 'name' || l.role === 'sign' || l.role === 'kiosk') FL[i] |= F.EMIS | (l.role === 'name' ? F.GLOW : 0);
      });
    }
    const AR = ROOMS.find((k) => k.kind === 'arena');
    if (AR) {
      const r = AR.r, put = (text, y, col) => [...text].forEach((ch, k) => { const x = r.x + Math.floor((r.w - text.length) / 2) + k; if (ch !== ' ' && inMap(x, y)) { CH[at(x, y)] = ch; setFG(at(x, y), col); } });
      put('════ Arena ════', r.y + 3, AR.accent); put('the train runs when you walk in', r.y + 4, [120, 130, 146]);
    }
    // frames: a thin dim frame, the print (the site's own cells, once loaded), a lamp bar on the wall
    LAMPS = [];
    const FRAMEC = [[90, 80, 66], [150, 124, 80], [70, 70, 74], [170, 166, 156]];
    const dying = map.frames.filter((f) => !f.darkroom && !f.backdrop)[5];
    for (const f of map.frames) {
      if (f.backdrop) continue;
      const li = LAMPS.length;
      LAMPS.push({ f, dying: f === dying });
      const ground = ROOMS[f.roomIndex] ? ROOMS[f.roomIndex].ground : COR.ground;
      const fc = f.darkroom ? [130, 112, 100] : FRAMEC[Math.floor(hash(f.x, f.y) * FRAMEC.length)];
      for (let y = f.y; y < f.y + f.h; y++) for (let x = f.x; x < f.x + f.w; x++) {
        const i = at(x, y), edge = x === f.x || y === f.y || x === f.x + f.w - 1 || y === f.y + f.h - 1;
        if (!(FL[i] & F.FACE)) setGround(i, ground);
        if (edge) {
          CH[i] = f.darkroom ? (y === f.y ? (x === f.x || x === f.x + f.w - 1 ? '┬' : '─') : ' ')
            : y === f.y ? (x === f.x ? '┌' : x === f.x + f.w - 1 ? '┐' : '─') : y === f.y + f.h - 1 ? (x === f.x ? '└' : x === f.x + f.w - 1 ? '┘' : '─') : '│';
          setFG(i, fc); FL[i] = F.PLAIN | (FL[i] & F.FACE);
          if (f.darkroom && y > f.y) setGround(i, [58, 50, 46]);
        } else { FL[i] = F.PRINT; LAMP_OF[i] = li; }
      }
      [...(f.plaque.text || '')].forEach((ch, k) => { const x = f.plaque.x + k, i = at(x, f.plaque.y); if (inMap(x, f.plaque.y) && ch !== ' ') { CH[i] = ch; setFG(i, f.darkroom ? [170, 90, 80] : [150, 140, 122]); } });
      if (f.darkroom) continue;
      const wy = f.wall === 'n' ? f.y - 1 : f.y + f.h, cx = f.x + Math.floor(f.w / 2), lw = Math.max(3, Math.min(9, Math.round(f.w / 4)));
      for (let x = cx - (lw >> 1); x < cx - (lw >> 1) + lw; x++) {
        if (!isWall(x, wy) && !(inMap(x, wy) && FL[at(x, wy)] & F.FACE)) continue;
        const i = at(x, wy);
        CH[i] = f.wall === 'n' ? '▄' : '▀'; setFG(i, [206, 172, 122]); FL[i] = (FL[i] & (F.ISLAND | F.FACE)) | F.PLAIN | F.EMIS | F.GLOW; LAMP_OF[i] = li;
      }
    }
  }

  // ---------- life ----------
  function makeLife(world) {
    const walk = (x, y) => isWalkable(map, x, y);
    const L = LOBBY.r;
    const lobbyFloor = () => { for (let k = 0; k < 80; k++) { const x = L.x + 2 + Math.floor(rnd() * (L.w - 4)), y = L.y + 2 + Math.floor(rnd() * (L.h - 4)); if (walk(x, y)) return [x, y]; } return [Math.floor(map.spawn.x), Math.floor(map.spawn.y)]; };
    const ends = ROOMS.filter((k) => k.r.entry && k.kind !== 'lobby' && k.kind !== 'arena').map((k) => [k.r.entry.x, k.r.entry.y]);
    world.visitors.forEach((v) => { v.talkAt = 2 + rnd() * 8; v.photographer = rnd() < 0.2; });
    return {
      walk, lobbyFloor, ends,
      cat: { x: L.x + 6.5, y: L.y + L.h - 4.5, spd: 3, path: null, nap: 6, follow: 0, dir: 0 },
      gus: { x: map.spawn.x - 6, y: map.spawn.y, spd: 5, path: null, k: 0, wait: 0, dir: 0 },
      say: new Map(),
    };
  }
  function route(a, gx, gy) {
    const cells = findPath(W, H, (x, y) => life.walk(x, y), Math.floor(a.x), Math.floor(a.y), gx, gy, 80000);
    a.path = cells ? cells.map((c) => ({ x: c.x + 0.5, y: c.y + 0.5 })) : null;
  }
  function advance(a, dt) {
    if (!a.path || !a.path.length) return true;
    const wp = a.path[0], dx = wp.x - a.x, dy = (wp.y - a.y) * CELL_ASPECT, d = Math.hypot(dx, dy), s = a.spd * dt;
    if (d <= s) { a.x = wp.x; a.y = wp.y; a.path.shift(); return !a.path.length; }
    a.x += (dx / d) * s; a.y += (dy / d) * s / CELL_ASPECT; a.dir = Math.atan2(dy, dx);
    return false;
  }
  const speak = (who, text, s = 2.4, t) => life.say.set(who, { text, until: t + s });
  function simLife(world, dt) {
    const t = world.t, p = world.player;
    for (const v of world.visitors) {
      if (v.looking && v.wait > 0 && t > v.talkAt) {
        const R = ROOMS[v.room], pool = R ? (R.kind === 'dark' ? ROOM_LOOK.dark : R.kind === 'silver' ? ROOM_LOOK.silver : R.warm ? ROOM_LOOK.warm : ROOM_LOOK.cool) : LOOK;
        if (v.photographer && rnd() < 0.6) v.flash = t; else speak(v, rnd() < 0.35 ? pick(pool) : pick(LOOK), 2.4, t);
        v.talkAt = t + 6 + rnd() * 9;
      }
    }
    const cat = life.cat;
    if (cat.nap > 0) cat.nap -= dt;
    else {
      const near = Math.hypot(p.x - cat.x, (p.y - cat.y) * CELL_ASPECT) < 14 && roomAt(map, p.x, p.y) === LOBBY.i;
      if (near && cat.follow <= 0 && rnd() < dt * 0.15) { cat.follow = 6; speak(cat, 'mrrp', 1.4, t); }
      if (cat.follow > 0) { cat.follow -= dt; if (!cat.path || !cat.path.length || rnd() < dt * 2) route(cat, Math.floor(p.x) - 2, Math.floor(p.y) + 1); }
      if (advance(cat, dt) && cat.follow <= 0) { if (rnd() < 0.45) cat.nap = 7 + rnd() * 9; else { const [gx, gy] = life.lobbyFloor(); route(cat, gx, gy); } }
    }
    const g = life.gus;
    if (g.wait > 0) g.wait -= dt;
    else if (advance(g, dt)) {
      g.wait = 1.5 + rnd() * 2.5;
      g.k = (g.k + 1) % (life.ends.length * 2);
      const goal = g.k % 2 ? life.lobbyFloor() : life.ends[(g.k >> 1) % life.ends.length];
      route(g, goal[0], goal[1]);
      if (rnd() < 0.3) speak(g, pick(['evening', 'all quiet', 'mind the frames', '…']), 1.8, t);
    }
  }
  const lampK = (li, t) => {
    const L = LAMPS[li]; if (!L) return 1;
    let k = 1;
    if (L.dying) { const ph = (t * 1000) % 11000; k *= ph < 2200 ? (hash(Math.floor(t * 14), 3) < 0.45 ? 0.1 : 0.85) : ph < 4200 ? 0.06 : hash(Math.floor(t * 11), 5) < 0.03 ? 0.4 : 1; }
    return k;
  };

  // ---------- lights that move ----------
  function clearLine(x0, y0, x1, y1) {
    let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy, x = x0, y = y0;
    while (x !== x1 || y !== y1) {
      if ((x !== x0 || y !== y0) && (map.tiles[y * W + x] === T.WALL || map.tiles[y * W + x] === T.VOID)) return false;
      const e2 = 2 * err; if (e2 >= dy) { err += dy; x += sx; } if (e2 <= dx) { err += dx; y += sy; }
    }
    return true;
  }
  function addLight(buf, wx, wy, ww, wh, lx, ly, col, rad, int, dir, spread) {
    const cx = Math.floor(lx), cy = Math.floor(ly), ry = Math.ceil(rad / CELL_ASPECT);
    for (let y = Math.max(wy, cy - ry, 0); y <= Math.min(wy + wh - 1, cy + ry, H - 1); y++) for (let x = Math.max(wx, cx - Math.ceil(rad), 0); x <= Math.min(wx + ww - 1, cx + Math.ceil(rad), W - 1); x++) {
      const dx = x + 0.5 - lx, dy = (y + 0.5 - ly) * CELL_ASPECT, d = Math.hypot(dx, dy) / rad;
      if (d >= 1) continue;
      let f = (1 - d) * (1 - d) * int;
      if (dir != null && d > 0.04) { let da = Math.abs(Math.atan2(dy, dx) - dir); if (da > Math.PI) da = 2 * Math.PI - da; if (da > spread) continue; f *= 1 - (da / spread) * 0.5; }
      if (!clearLine(cx, cy, x, y)) continue;
      const i = ((y - wy) * ww + (x - wx)) * 3;
      buf[i] += col[0] * f; buf[i + 1] += col[1] * f; buf[i + 2] += col[2] * f;
    }
  }

  // ---------- prints: the site's own cells, from the 512px images ----------
  function request(f) {
    if (requested.has(f.id)) return;
    requested.add(f.id);
    loadImage(f.photo, 'low').then((bmp) => { bitmaps.set(f.id, bmp); invalidate(f); onLoad.forEach((cb) => cb(f)); }, () => invalidate(f));
  }

  // ---------- the still layer, baked in chunks (as the site does): floors, walls, prints, words ----------
  // Colours are baked brighter than they show (BRIGHT); the light, multiplied over them, brings them down.
  const CW = 48, CHK = 24, BRIGHT = 1.4;
  const chunks = new Map();
  let EMIS = null;
  const sprites = new Map(); // 'ch|colour' → a glyph with its glow, blurred once
  function glowSprite(ch, col, m) {
    const key = `${ch}|${css(col)}`;
    let s = sprites.get(key);
    if (!s) {
      if (sprites.size > 400) sprites.clear();
      const pad = Math.ceil(m.fontPx), c = new OffscreenCanvas(Math.ceil((m.cw + pad * 2) * dpr), Math.ceil((m.ch + pad * 2) * dpr)), g = c.getContext('2d');
      g.scale(dpr, dpr); prepareText(g, m.font);
      g.shadowBlur = Math.round(m.fontPx * 0.9) * dpr; g.shadowColor = g.fillStyle = css(col);
      drawGlyph(g, ch, pad, pad, m.cw, m.ch, m.fontPx);
      sprites.set(key, (s = { cv: c, pad }));
    }
    return s;
  }
  // The glowing things (lamp bars, the name, signs) are baked too, glow and all, on a clear layer drawn over
  // the light; only a failing lamp is drawn each frame. A margin catches glow from the next chunk over.
  const glowChunks = new Map();
  function bakeGlow(ix, iy, m) {
    const cw = m.cw, chh = m.ch, x0 = ix * CW, y0 = iy * CHK, M = 2;
    let cv = null, c = null;
    for (let y = y0 - M; y < y0 + CHK + M; y++) {
      if (y < 0 || y >= H) continue;
      for (let x = x0 - M; x < x0 + CW + M; x++) {
        if (x < 0 || x >= W) continue;
        const i = y * W + x;
        if (!(FL[i] & F.EMIS) || (LAMP_OF[i] >= 0 && LAMPS[LAMP_OF[i]].dying)) continue;
        if (!cv) { cv = new OffscreenCanvas(Math.ceil(CW * cw * dpr), Math.ceil(CHK * chh * dpr)); c = cv.getContext('2d'); c.scale(dpr, dpr); prepareText(c, m.font); }
        const col = [FG[i * 3], FG[i * 3 + 1], FG[i * 3 + 2]], px = (x - x0) * cw, py = (y - y0) * chh, inside = x >= x0 && x < x0 + CW && y >= y0 && y < y0 + CHK;
        if (inside) { c.fillStyle = css(col); drawGlyph(c, CH[i], px, py, cw, chh, m.fontPx); }
        if (FL[i] & F.GLOW) {
          const s = glowSprite(CH[i], col, m);
          c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.35;
          c.drawImage(s.cv, px - s.pad, py - s.pad, cw + s.pad * 2, chh + s.pad * 2);
          c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
        }
      }
    }
    return cv; // null: nothing glows here
  }
  function invalidate(f) {
    for (let iy = Math.floor(f.y / CHK); iy <= Math.floor((f.y + f.h) / CHK); iy++)
      for (let ix = Math.floor(f.x / CW); ix <= Math.floor((f.x + f.w) / CW); ix++) chunks.delete(`${ix},${iy}`);
  }
  function bake(ix, iy, m) {
    const cw = m.cw, chh = m.ch;
    const cv = new OffscreenCanvas(Math.ceil(CW * cw * dpr), Math.ceil(CHK * chh * dpr)), c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = rgb(...C.bg); c.fillRect(0, 0, CW * cw, CHK * chh);
    prepareText(c, m.font);
    const x0 = ix * CW, y0 = iy * CHK, walls = [], glyphs = [];
    for (let y = 0; y < CHK; y++) {
      const wy = y0 + y; if (wy < 0 || wy >= H) continue;
      for (let x = 0; x < CW; x++) {
        const wx = x0 + x; if (wx < 0 || wx >= W) continue;
        const i = wy * W + wx, fl = FL[i];
        if (!fl) continue;
        const px = x * cw, py = y * chh;
        if (fl & F.PRINT) {
          const f = LAMPS[LAMP_OF[i]].f, bmp = bitmaps.get(f.id), cells = bmp ? cellsFor(f.photo, f.cols, f.rows, f.darkroom, bmp) : null;
          const rx = wx - f.x - 1, ry = wy - f.y - 1, k = ry * f.cols + rx;
          if (cells) {
            c.fillStyle = css([cells.bg[k * 3], cells.bg[k * 3 + 1], cells.bg[k * 3 + 2]]); c.fillRect(px, py, cw + 0.5, chh + 0.5);
            glyphs.push([RAMP[cells.glyph[k]], px, py, [cells.fg[k * 3], cells.fg[k * 3 + 1], cells.fg[k * 3 + 2]]]);
          } else {
            c.fillStyle = 'rgb(10,10,12)'; c.fillRect(px, py, cw + 0.5, chh + 0.5);
            const bad = hasFailed(f.id);
            if (bad ? (rx + ry) % 2 : (rx + ry * 3) % 7 === 0) glyphs.push([bad ? '?' : '·', px, py, [70, 66, 60]]);
          }
          continue;
        }
        c.fillStyle = css(mul([GROUND[i * 3], GROUND[i * 3 + 1], GROUND[i * 3 + 2]], BRIGHT)); c.fillRect(px, py, cw + 0.5, chh + 0.5);
        const col = mul([FG[i * 3], FG[i * 3 + 1], FG[i * 3 + 2]], BRIGHT);
        if (fl & F.ISLAND) {
          c.fillStyle = css(fl & F.EMIS ? mul([112, 104, 92], BRIGHT) : col);
          if (!(FL[i - W] & F.ISLAND)) c.fillRect(px, py, cw + 0.5, 1.5); // its edges catch the light
          if (!(FL[i + W] & F.ISLAND)) c.fillRect(px, py + chh - 1.5, cw + 0.5, 1.5);
          if (!(FL[i - 1] & F.ISLAND)) c.fillRect(px, py, 1.5, chh + 0.5);
          if (!(FL[i + 1] & F.ISLAND)) c.fillRect(px + cw - 1.5, py, 1.5, chh + 0.5);
          if (CH[i] === ' ') continue;
        }
        if (fl & F.EMIS) continue; // drawn over the light, from the glow layer
        if ((fl & F.WALL) && CH[i] === ' ') walls.push([WALLM[i], px, py, col]);
        else if (CH[i] !== ' ') glyphs.push([CH[i], px, py, col]);
      }
    }
    // walls: heavy lines toward each wall neighbour
    c.lineCap = 'square'; c.lineWidth = Math.max(1.5, cw * 0.42);
    for (const [mk, px, py, col] of walls) {
      const cx = px + cw / 2, cy = py + chh / 2;
      c.strokeStyle = css(col); c.beginPath();
      if (mk & 1) { c.moveTo(cx, cy); c.lineTo(cx, py); }
      if (mk & 4) { c.moveTo(cx, cy); c.lineTo(cx, py + chh); }
      if (mk & 2) { c.moveTo(cx, cy); c.lineTo(px + cw, cy); }
      if (mk & 8) { c.moveTo(cx, cy); c.lineTo(px, cy); }
      if (!(mk & 15)) { c.moveTo(cx - 1, cy); c.lineTo(cx + 1, cy); }
      c.stroke();
    }
    for (const [ch, px, py, col] of glyphs) { c.fillStyle = css(col); drawGlyph(c, ch, px, py, cw, chh, m.fontPx); }
    return cv;
  }

  // ---------- the interface main.js uses ----------
  function resize(w, h, ratio) {
    viewW = w; viewH = h; dpr = ratio;
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    chunks.clear(); glowChunks.clear(); sprites.clear();
    return site.resize(w, h, ratio);
  }
  const setView = (z) => site.setView(z); // called every frame; the top-down cells never change size here
  const metrics = () => site.metrics;
  const cellAt = (world, px, py) => site.cellAt(world, px, py);
  const pointAt = (world, px, py) => site.pointAt(world, px, py);
  function draw(world) {
    const m = site.metrics;
    if (!m) return;
    if (world.mode === 'side' && map.arena) { site.draw(world); return; }
    if (!life) life = makeLife(world);
    if (!EMIS) { EMIS = []; for (let i = 0; i < W * H; i++) if ((FL[i] & F.EMIS) && LAMP_OF[i] >= 0 && LAMPS[LAMP_OF[i]].dying) EMIS.push(i); } // the failing lamp's cells
    const dt = lastT == null ? 0 : clamp(world.t - lastT, 0, 0.1);
    lastT = world.t;
    if (!world.reducedMotion) simLife(world, dt);
    const t = world.t, cw = m.cw, chh = m.ch, cols = viewW / cw, rows = viewH / chh;
    const left = world.cam.x - cols / 2, top = world.cam.y - rows / 2;
    const sx = (cx) => Math.round((cx - left) * cw * dpr) / dpr, sy = (cy) => Math.round((cy - top) * chh * dpr) / dpr;
    for (const f of map.frames) if (!f.backdrop && f.x < left + cols * 2 && f.x + f.w > left - cols && f.y < top + rows * 2 && f.y + f.h > top - rows) request(f);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0; ctx.imageSmoothingEnabled = true; // the site renderer shares this context
    ctx.fillStyle = rgb(...C.bg); ctx.fillRect(0, 0, viewW, viewH);
    // 1. the still layer
    const ix0 = Math.floor(left / CW), ix1 = Math.floor((left + cols) / CW), iy0 = Math.floor(top / CHK), iy1 = Math.floor((top + rows) / CHK);
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const key = `${ix},${iy}`;
      let cv = chunks.get(key);
      if (!cv) { cv = bake(ix, iy, m); chunks.set(key, cv); }
      ctx.drawImage(cv, sx(ix * CW), sy(iy * CHK), CW * cw, CHK * chh);
    }
    for (const cache of [chunks, glowChunks]) for (const key of cache.keys()) { const [ix, iy] = key.split(',').map(Number); if (ix < ix0 - 2 || ix > ix1 + 2 || iy < iy0 - 2 || iy > iy1 + 2) cache.delete(key); }

    ctx.save();
    ctx.translate(sx(0), sy(0));
    prepareText(ctx, m.font);
    const P = (x, y, ch, col) => { ctx.fillStyle = css(col); drawGlyph(ctx, ch, x * cw, y * chh, cw, chh, m.fontPx); };
    // 2. what moves under the light: dust in the picture lights, the trays, drips, people, Gus and Mochi
    const v0x = Math.floor(left) - 1, v0y = Math.floor(top) - 1, v1x = v0x + Math.ceil(cols) + 3, v1y = v0y + Math.ceil(rows) + 3;
    const inView = (x, y) => x >= v0x && x <= v1x && y >= v0y && y <= v1y;
    if (!world.reducedMotion) {
      for (let li = 0; li < LAMPS.length; li++) {
        const f = LAMPS[li].f; if (f.darkroom || f.x > v1x || f.x + f.w < v0x || f.y > v1y + 4 || f.y + f.h < v0y - 4) continue;
        const dirY = f.wall === 'n' ? 1 : -1, y0 = f.wall === 'n' ? f.y + f.h + 1 : f.y - 2;
        for (let k = 0; k < 2; k++) {
          const age = mod(t + hash(li, k) * 7, 7) / 7;
          P(Math.floor(f.x + 2 + hash(li, k + 4) * (f.w - 4) + Math.sin(age * 5 + k) * 1.2), y0 + dirY * Math.floor(age * 4), '·', mul([255, 228, 190], 1.3 * lampK(li, t) * (1 - age)));
        }
      }
      for (const i of TRAYS) { const x = i % W, y = (i / W) | 0; if (inView(x, y)) { ctx.fillStyle = css(mul(GROUND.subarray(i * 3, i * 3 + 3), BRIGHT)); ctx.fillRect(x * cw, y * chh, cw + 0.5, chh + 0.5); P(x, y, '~≈-~'[(x + Math.floor(t * 3.3)) % 4], [190, 70, 56]); } }
      for (const f of map.frames) if (f.darkroom && inView(f.x, f.y)) { const age = mod(t * 1000 + f.x * 137, 2600); if (age < 800) P(f.x + Math.floor(f.w / 2), f.y + f.h + 1 + Math.floor(age / 400), '.', [220, 70, 60]); }
    }
    const plate = (x, y) => { ctx.fillStyle = rgb(...C.bg); ctx.fillRect((x + 0.1) * cw, (y + 0.1) * chh, cw * 0.8, chh * 0.8); };
    const cat = life.cat, g = life.gus, ccx = Math.floor(cat.x), ccy = Math.floor(cat.y);
    if (inView(ccx, ccy)) {
      plate(ccx, ccy); P(ccx, ccy, 'ω', [245, 178, 96]);
      if (cat.nap > 0) { const z = Math.floor(t / 0.7) % 4; if (z < 3) P(ccx + 1 + (z % 2), ccy - 1 - z, 'z', [200, 200, 220]); }
      else P(ccx - (Math.cos(cat.dir || 0) >= 0 ? 1 : -1), ccy, '~', [210, 146, 74]);
    }
    if (inView(Math.floor(g.x), Math.floor(g.y))) { plate(Math.floor(g.x), Math.floor(g.y)); P(Math.floor(g.x), Math.floor(g.y), 'G', [140, 178, 255]); }
    for (const e of world.people || []) {
      if (e.glyph !== '·' && e.glyph !== '!') plate(e.x - 0.5, e.y - 0.5);
      ctx.fillStyle = rgb(...e.color); drawGlyph(ctx, e.glyph, (e.x - 0.5) * cw, (e.y - 0.5) * chh, cw, chh, m.fontPx);
    }

    // 3. the light, one pixel per cell, smoothed up and multiplied over all of it: the site's lights (lamps,
    //    the darkroom's safelight, your lantern) with Gus's torch and camera flashes added in
    const ww = v1x - v0x + 1, wh = v1y - v0y + 1;
    const lw = world.lighting ? lightWindow(world.lighting, v0x, v0y, ww, wh, world.player, t, !world.reducedMotion) : null;
    const dyn = new Float32Array(ww * wh * 3);
    addLight(dyn, v0x, v0y, ww, wh, g.x, g.y, [1, 0.96, 0.82], 26, 0.9, g.dir || 0, 0.42);
    for (const v of world.visitors) if (v.flash && t - v.flash < 0.22) addLight(dyn, v0x, v0y, ww, wh, v.x, v.y - 1, [1, 1, 1], 18, 2.4 * (1 - (t - v.flash) / 0.22));
    if (!LIGHT.img || LIGHT.cv.width !== ww || LIGHT.cv.height !== wh) { LIGHT.cv.width = ww; LIGHT.cv.height = wh; LIGHT.img = LIGHT.cx.createImageData(ww, wh); }
    const img = LIGHT.img.data;
    for (let y = 0; y < wh; y++) for (let x = 0; x < ww; x++) {
      const k = y * ww + x, o = k * 4, d = k * 3, wx = v0x + x, wy = v0y + y;
      const i = wx >= 0 && wy >= 0 && wx < W && wy < H ? wy * W + wx : -1;
      if (i >= 0 && (FL[i] & F.PRINT) && !LAMPS[LAMP_OF[i]].f.darkroom) {
        // a print shows by its own lamp (which can fail), not by the floor's light
        const f = clamp((0.4 + 0.72 * lampK(LAMP_OF[i], t)) , 0.12, 1) * 255 + dyn[d] * 120;
        img[o] = img[o + 1] = img[o + 2] = f; img[o + 3] = 255;
        continue;
      }
      if (i >= 0 && map.tiles[i] === T.WALL && !(FL[i] & F.EMIS)) {
        // wall lines (and an island's top) keep one steady light: lit where light touched them, they streaked
        img[o] = img[o + 1] = img[o + 2] = WALL_L * 255; img[o + 3] = 255;
        continue;
      }
      const wallK = i >= 0 && FL[i] & F.FACE ? FACE_K : 1; // a wall face stands up out of the light the floor gets
      for (let j = 0; j < 3; j++) {
        const L = (lw ? lw.rgba[o + j] / 255 : 0.6) + dyn[d + j];
        img[o + j] = clamp(wallK * (LIFT + GAIN * L) / BRIGHT, FLOOR, 1) * 255;
      }
      img[o + 3] = 255;
    }
    LIGHT.cx.putImageData(LIGHT.img, 0, 0);
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.globalCompositeOperation = 'multiply';
    ctx.drawImage(LIGHT.cv, v0x * cw, v0y * chh, ww * cw, wh * chh);
    if (lw) {
      if (!LIGHT.glow || LIGHT.glow.width !== ww || LIGHT.glow.height !== wh) LIGHT.glow = new OffscreenCanvas(ww, wh);
      LIGHT.glow.getContext('2d').putImageData(new ImageData(lw.glow, ww, wh), 0, 0);
      ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = HAZE;
      ctx.drawImage(LIGHT.glow, v0x * cw, v0y * chh, ww * cw, wh * chh);
    }
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

    // 4. what gives off light: lamp bars over the prints, the name, the signs, the desk (baked), then the
    //    failing lamp and camera flashes
    ctx.restore();
    for (let iy = iy0; iy <= iy1; iy++) for (let ix = ix0; ix <= ix1; ix++) {
      const key = `${ix},${iy}`;
      if (!glowChunks.has(key)) glowChunks.set(key, bakeGlow(ix, iy, m));
      const cv = glowChunks.get(key);
      if (cv) ctx.drawImage(cv, sx(ix * CW), sy(iy * CHK), CW * cw, CHK * chh);
    }
    ctx.save();
    ctx.translate(sx(0), sy(0));
    prepareText(ctx, m.font);
    const glow = [];
    for (const i of EMIS) {
      const x = i % W, y = (i / W) | 0; if (!inView(x, y)) continue;
      const k = lampK(LAMP_OF[i], t), base = [FG[i * 3], FG[i * 3 + 1], FG[i * 3 + 2]];
      P(x, y, CH[i], mul(base, 0.12 + 0.88 * k));
      if (k > 0.5) glow.push([x, y, CH[i], base, k]);
    }
    if (!world.reducedMotion) for (const v of world.visitors) if (v.flash && t - v.flash < 0.2) { P(Math.floor(v.x) + 1, Math.floor(v.y) - 1, '*', [255, 255, 255]); glow.push([Math.floor(v.x) + 1, Math.floor(v.y) - 1, '*', [255, 255, 255], 1]); }
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    for (const [x, y, ch, col, k] of glow) {
      const s = glowSprite(ch, col, m);
      ctx.globalAlpha = 0.35 * k;
      ctx.drawImage(s.cv, x * cw - s.pad, y * chh - s.pad, cw + s.pad * 2, chh + s.pad * 2);
    }
    ctx.restore();

    // 5. the focused frame, as the site marks it
    const fo = world.focus;
    if (fo && !fo.darkroom && !fo.backdrop) {
      const x1 = fo.x + fo.w - 1, y1 = fo.y + fo.h - 1;
      for (let x = fo.x; x <= x1; x++) { P(x, fo.y, x === fo.x ? '┌' : x === x1 ? '┐' : '─', C.frameFocus); P(x, y1, x === fo.x ? '└' : x === x1 ? '┘' : '─', C.frameFocus); }
      for (let y = fo.y + 1; y < y1; y++) { P(fo.x, y, '│', C.frameFocus); P(x1, y, '│', C.frameFocus); }
    }
    ctx.restore();

    // 7. you and anyone else online, over everything; then what people say
    ctx.save();
    ctx.translate(sx(0), sy(0));
    prepareText(ctx, m.font);
    for (const e of world.entities || []) {
      plate(e.x - 0.5, e.y - 0.5);
      ctx.fillStyle = rgb(...e.color); drawGlyph(ctx, e.glyph, (e.x - 0.5) * cw, (e.y - 0.5) * chh, cw, chh, m.fontPx);
    }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [who, s] of life.say) {
      if (s.until <= t) { life.say.delete(who); continue; }
      if (!inView(Math.floor(who.x), Math.floor(who.y))) continue;
      const col = who.color || (who === g ? [140, 178, 255] : [245, 178, 96]);
      const px = who.x * cw, py = (who.y - 1.4) * chh, w = ctx.measureText(s.text).width + 10;
      ctx.fillStyle = 'rgba(8,8,10,0.85)'; ctx.fillRect(px - w / 2, py - chh * 0.5, w, chh);
      ctx.fillStyle = css(mix(col, [255, 255, 255], 0.35)); ctx.fillText(s.text, px, py);
    }
    ctx.restore();
  }

  function dispose() { site.dispose(); ctx = null; }
  return { name, init, resize, setView, draw, dispose, cellAt, pointAt, onLoad, missing: new Set(), get metrics() { return metrics(); } };
}

export const createMuseumRenderer = () => createMuseumLook('museum');
