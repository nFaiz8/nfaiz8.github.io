// The arena's level file: one kind per interior cell, top row first, plus spawn (S), pickup (R rifle,
// N sniper), door (D) and ladder (H) markers, which are air. Pure and import-free, so the Worker can bundle it.
export const AIR = 0, PLATFORM = 1, SOLID = 2;
export const LEVEL_COLS = 204, LEVEL_ROWS = 33;
export const PICKUP_GUN = { R: 'rifle', N: 'sniper' };

// The arena's maps (gorge addendum): the train (src/arena.txt) and the gorge (src/gorge.txt), each with its
// size. steps: a tread a row up is walked onto (the gorge's stairs and terrace); dummy: the practice dummy
// stands in it when you're alone.
export const MAPS = {
  train: { cols: LEVEL_COLS, rows: LEVEL_ROWS, steps: false, dummy: true },
  gorge: { cols: 212, rows: 112, steps: true, dummy: false },
};
export const MAP_NAMES = Object.keys(MAPS);
export const DEFAULT_MAP = 'train';
export const mapName = (name) => (Object.hasOwn(MAPS, name) ? name : DEFAULT_MAP);
// A map's level, parsed at its own size and carrying its name and rules.
export function parseMap(name, text) {
  const m = MAPS[mapName(name)];
  return { ...parseLevel(text, m.cols, m.rows), name: mapName(name), steps: m.steps, dummy: m.dummy };
}

// Anything unexpected is air, so a typo can't wall you in.
export function parseLevel(text, cols = LEVEL_COLS, rows = LEVEL_ROWS) {
  const cells = new Uint8Array(cols * rows);
  const spawns = [], pickups = [], rungs = [];
  let door = null; // where a body standing in the doorway is: the room's way out
  const lines = String(text).replace(/\r/g, '').split('\n');
  for (let r = 0; r < rows; r++) {
    const chars = [...(lines[r] || '')];
    for (let c = 0; c < cols; c++) {
      const ch = chars[c];
      cells[r * cols + c] = ch === '═' ? PLATFORM : ch === '▓' ? SOLID : AIR;
      const spot = { c, r, x: c + 0.5, y: r - 0.5 };
      if (ch === 'S') spawns.push(spot);
      else if (ch === 'D') door = spot;
      else if (PICKUP_GUN[ch]) pickups.push({ n: pickups.length, gun: PICKUP_GUN[ch], ...spot });
      else if (ch === 'H') rungs.push(c * rows + r);
    }
  }
  return { cols, rows, cells, spawns, pickups, door, ladders: laddersOf(rungs, rows) };
}

// A ladder is a column of H, from the tread over its top (top: the row you stand on up there) down to
// the one under its foot (bot): { x (the column's middle), top, bot }, left to right, then top down.
function laddersOf(rungs, rows) {
  const out = [];
  rungs.sort((a, b) => a - b);
  for (let k = 0; k < rungs.length; k++) {
    const c = Math.floor(rungs[k] / rows), r0 = rungs[k] % rows;
    while (k + 1 < rungs.length && rungs[k + 1] === rungs[k] + 1 && Math.floor(rungs[k + 1] / rows) === c) k++;
    out.push({ x: c + 0.5, top: r0 - 1, bot: (rungs[k] % rows) + 1 });
  }
  return out;
}

// Where a pickup may appear (pickups addendum): any spot a body can stand on (floor or platform under it,
// three clear rows over it), clear of the level's sides and of the doorway. The level's R and N say which
// guns there are; where they appear is the referee's to pick from these.
export function pickupSpots(L) {
  const k = levelKind(L), out = [];
  for (let r = 2; r < L.rows - 1; r++) {
    for (let c = 4; c < L.cols - 4; c++) {
      if (k(c, r + 1) === AIR || k(c, r) || k(c, r - 1) || k(c, r - 2)) continue;
      if (L.door && r === L.door.r && Math.abs(c - L.door.c) < 10) continue;
      out.push({ c, r, x: c + 0.5, y: r - 0.5 });
    }
  }
  return out;
}

export const levelKind = (L) => (c, r) => (c < 0 || r < 0 || c >= L.cols || r >= L.rows ? SOLID : L.cells[r * L.cols + c]);

// Server and browser compare this, so neither fights on a level the other doesn't have.
export function levelHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text).replace(/\r/g, '')) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
