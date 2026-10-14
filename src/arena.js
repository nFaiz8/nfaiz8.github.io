// The arena: a side-scrolling room. Pure: the level, platform physics, the side-view camera and the
// backdrop crop. world.js hands the player to stepBody while you're inside.

export const AIR = 0, PLATFORM = 1, SOLID = 2;
export const LEVEL_COLS = 240, LEVEL_ROWS = 50;

// src/arena.txt → one kind per interior cell, top row first. Anything unexpected is air, so a typo can't
// wall you in.
export function parseLevel(text, cols = LEVEL_COLS, rows = LEVEL_ROWS) {
  const cells = new Uint8Array(cols * rows);
  const lines = String(text).split('\n');
  for (let r = 0; r < rows; r++) {
    const chars = [...(lines[r] || '')];
    for (let c = 0; c < cols; c++) cells[r * cols + c] = chars[c] === '═' ? PLATFORM : chars[c] === '▓' ? SOLID : AIR;
  }
  return { cols, rows, cells };
}
