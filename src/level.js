// The arena's level file: one kind per interior cell, top row first, plus spawn (S), pickup (R rifle,
// N sniper) and door (D) markers, which are air. Pure and import-free, so the Worker can bundle it.
export const AIR = 0, PLATFORM = 1, SOLID = 2;
export const LEVEL_COLS = 204, LEVEL_ROWS = 33;
export const PICKUP_GUN = { R: 'rifle', N: 'sniper' };

// Anything unexpected is air, so a typo can't wall you in.
export function parseLevel(text, cols = LEVEL_COLS, rows = LEVEL_ROWS) {
  const cells = new Uint8Array(cols * rows);
  const spawns = [], pickups = [];
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
    }
  }
  return { cols, rows, cells, spawns, pickups, door };
}

export const levelKind = (L) => (c, r) => (c < 0 || r < 0 || c >= L.cols || r >= L.rows ? SOLID : L.cells[r * L.cols + c]);

// Server and browser compare this, so neither fights on a level the other doesn't have.
export function levelHash(text) {
  let h = 0x811c9dc5;
  for (const ch of String(text).replace(/\r/g, '')) h = Math.imul(h ^ ch.codePointAt(0), 0x01000193) >>> 0;
  return h.toString(16).padStart(8, '0');
}
