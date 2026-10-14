// Lighting on the cell grid. Static lights (a picture light over every print, a lamp in each room, the
// darkroom safelight) are cast once into a map-sized light buffer. The lantern you carry is cast every
// frame into just the visible window. Walls block light; a wall cell facing a light is lit itself.
import { T, CELL_ASPECT } from './layout.js';

const AMBIENT = [0.2, 0.21, 0.27]; // moonlight through the skylights
const LANTERN = { color: [1.0, 0.8, 0.56], radius: 28, intensity: 1.1 };

const blocks = (t) => t === T.WALL || t === T.VOID; // props (frames, benches) don't cast shadows

// Is there a clear line from cell (x0, y0) to (x1, y1)? The target itself may be a wall (so walls get lit).
function clear(map, x0, y0, x1, y1) {
  let dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  while (x !== x1 || y !== y1) {
    if ((x !== x0 || y !== y0) && blocks(map.tiles[y * map.W + x])) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
  return true;
}

// Add one light into buf (rgb floats) covering the window (wx, wy, ww, wh) of the map.
// The light sits at fractional cell position (lx, ly); radius is in horizontal cells.
export function castLight(map, buf, wx, wy, ww, wh, light) {
  const { x: lx, y: ly, radius, color, intensity } = light;
  const cx = Math.floor(lx), cy = Math.floor(ly);
  const rx = Math.ceil(radius), ry = Math.ceil(radius / CELL_ASPECT);
  const x0 = Math.max(wx, cx - rx), x1 = Math.min(wx + ww - 1, cx + rx);
  const y0 = Math.max(wy, cy - ry), y1 = Math.min(wy + wh - 1, cy + ry);
  if (cx < 0 || cy < 0 || cx >= map.W || cy >= map.H) return;
  for (let y = y0; y <= y1; y++) {
    if (y < 0 || y >= map.H) continue;
    for (let x = x0; x <= x1; x++) {
      if (x < 0 || x >= map.W) continue;
      const d = Math.hypot(x + 0.5 - lx, (y + 0.5 - ly) * CELL_ASPECT) / radius;
      if (d >= 1) continue;
      if (!clear(map, cx, cy, x, y)) continue;
      const f = (1 - d * d) * (1 - d) * intensity;
      const i = ((y - wy) * ww + (x - wx)) * 3;
      buf[i] += color[0] * f;
      buf[i + 1] += color[1] * f;
      buf[i + 2] += color[2] * f;
    }
  }
}

function hueColor(h) {
  // A pale tint of the room's hue, mostly white so prints keep their colours.
  const k = (n) => (n + h / 30) % 12;
  const f = (n) => 0.5 - 0.5 * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [0, 8, 4].map((n) => 0.88 + 0.12 * f(n));
}

// A ceiling lamp at the middle of a room can land inside a wall face or an island (layout.js), which
// don't block light, so it would shine out of the wall. It moves out over the open floor of the nearest
// aisle, a few rows from the wall; a lamp already over open floor stays where it is.
function openRow(map, lx, ly) {
  const x = Math.floor(lx), y = Math.floor(ly);
  const open = (yy) => yy >= 0 && yy < map.H && (map.tiles[yy * map.W + x] === T.FLOOR || map.tiles[yy * map.W + x] === T.DOOR);
  if (x < 0 || x >= map.W || open(y)) return ly;
  for (let d = 1; d < map.H; d++) for (const dir of [-1, 1]) {
    if (!open(y + dir * d)) continue;
    let ny = y + dir * d;
    for (let k = 0; k < 3 && open(ny + dir); k++) ny += dir;
    return ny + 0.5;
  }
  return ly;
}

// The fixed lights of the building, derived from the layout (deterministic).
export function staticLights(map) {
  const lights = [];
  map.rooms.forEach((r, i) => {
    if (r.arena) return; // lit only in its own side view
    const dark = r.plan && r.plan.darkroom;
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    if (dark) {
      lights.push({ x: cx, y: cy, radius: Math.max(r.w, r.h * 2) * 0.75, color: [1.0, 0.18, 0.12], intensity: 1.3, safelight: true });
      return;
    }
    // A row of lamps down the middle of the room, lightly tinted with the room's colour.
    const tint = i > 0 && r.hue != null ? hueColor(r.hue) : [1.0, 0.9, 0.72];
    const n = Math.max(1, Math.round(r.w / 48));
    for (let k = 0; k < n; k++) {
      const x = r.x + (r.w * (k + 0.5)) / n;
      lights.push({ x, y: openRow(map, x, cy), radius: Math.max(30, r.h * 1.4), color: tint, intensity: 0.42 });
    }
  });
  // Corridor lamps: a regular grid over floor that isn't inside any room.
  const inRoom = (x, y) => map.rooms.some((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  for (let y = 6; y < map.H; y += 14) {
    for (let x = 4; x < map.W; x += 34) {
      const t = map.tiles[y * map.W + x];
      if ((t === T.FLOOR || t === T.DOOR) && !inRoom(x, y)) lights.push({ x: x + 0.5, y: y + 0.5, radius: 22, color: [1.0, 0.86, 0.66], intensity: 0.4 });
    }
  }
  for (const f of map.frames) {
    if (f.darkroom || f.backdrop) continue;
    // Picture light: just in front of the print, on the side you view it from.
    const front = f.stand.y + 0.5 > f.y + f.h / 2 ? f.y + f.h + 1 : f.y - 1;
    lights.push({ x: f.x + f.w / 2, y: front + 0.5, radius: Math.max(16, f.w * 0.8), color: [1.0, 0.92, 0.78], intensity: 0.75 });
  }
  return lights;
}

// Bake the static lights into a map-sized buffer. Prints are lit from within so they stay the
// brightest thing on screen.
export function createLighting(map, { ambient = AMBIENT, lights = staticLights(map), prints = true, lantern = true } = {}) {
  const buf = new Float32Array(map.W * map.H * 3);
  for (let i = 0; i < map.W * map.H; i++) buf.set(ambient, i * 3);
  for (const l of lights) castLight(map, buf, 0, 0, map.W, map.H, l);
  const print = new Uint8Array(map.W * map.H);
  for (const f of prints ? map.frames : []) {
    if (f.backdrop) continue;
    for (let y = f.y + 1; y < f.y + f.h - 1; y++) {
      for (let x = f.x + 1; x < f.x + f.w - 1; x++) {
        print[y * map.W + x] = 1;
        const i = (y * map.W + x) * 3;
        const glow = f.darkroom ? [0.9, 0.55, 0.5] : [1, 1, 1];
        for (let c = 0; c < 3; c++) buf[i + c] = Math.max(buf[i + c], glow[c]);
      }
    }
  }
  const dark = map.rooms.find((r) => r.plan && r.plan.darkroom) || null;
  return { map, buf, print, lights, dark, ambient, lantern, scratch: new Float32Array(0) };
}

// The light for a window of the map: static light plus the lantern at (px, py), flickering with t.
// Returns RGBA bytes, one pixel per cell, and the glow (lantern, light pools) for an additive pass.
export function lightWindow(lighting, wx, wy, ww, wh, lantern, t = 0, flicker = true) {
  const { map, buf, print, dark } = lighting;
  const amb = lighting.ambient || AMBIENT;
  // The safelight breathes very slowly: ±8% over about six seconds.
  const pulse = flicker ? 1 + 0.08 * Math.sin((t * 2 * Math.PI) / 6) : 1;
  const n = ww * wh;
  if (lighting.scratch.length < n * 3) lighting.scratch = new Float32Array(n * 3);
  const dyn = lighting.scratch;
  dyn.fill(0, 0, n * 3);
  const k = flicker ? 1 + 0.05 * Math.sin(t * 7.3) * Math.sin(t * 2.9 + 1.3) + 0.02 * Math.sin(t * 23) : 1;
  if (lantern && lighting.lantern !== false) castLight(map, dyn, wx, wy, ww, wh, { ...LANTERN, x: lantern.x, y: lantern.y, intensity: LANTERN.intensity * k });
  const out = new Uint8ClampedArray(n * 4);
  const glow = new Uint8ClampedArray(n * 4);
  for (let y = 0; y < wh; y++) {
    const my = wy + y;
    for (let x = 0; x < ww; x++) {
      const mx = wx + x;
      const o = (y * ww + x) * 4, d = (y * ww + x) * 3;
      const inside = mx >= 0 && my >= 0 && mx < map.W && my < map.H;
      const s = inside ? (my * map.W + mx) * 3 : -1;
      const isPrint = inside && print[my * map.W + mx];
      const inDark = dark && !isPrint && mx >= dark.x && mx < dark.x + dark.w && my >= dark.y && my < dark.y + dark.h;
      for (let c = 0; c < 3; c++) {
        const st = (s >= 0 ? buf[s + c] : amb[c] * 0.5) * (inDark ? pulse : 1);
        const v = st + dyn[d + c];
        out[o + c] = Math.min(1, v) * 255;
        // A faint haze where light falls, so pools of light show on the dark floor too.
        const ex = isPrint ? 0 : Math.max(0, Math.min(1, st) - amb[c]);
        glow[o + c] = ex * 22 + dyn[d + c] * dyn[d + c] * 34;
      }
      out[o + 3] = 255;
      glow[o + 3] = 255;
    }
  }
  return { rgba: out, glow };
}
