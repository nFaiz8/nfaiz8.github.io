// The station's map (station spec §3): a text grid in which one character is one 1 × 1 tile. x is the
// column (east), z the row (south) and y is up. Pure (no three.js), so the checker and the tests use it too.
export const LEVEL = { hall: 0, platform: -3, track: -4.2 };
const FIXED = { '.': LEVEL.hall, t: LEVEL.hall, ':': LEVEL.hall, k: LEVEL.hall, _: LEVEL.platform, '!': LEVEL.platform, '=': LEVEL.track };
const NEUTRAL = new Set(['b', '~', 'S', 'E', '|']); // they take the level of the floor around them
export const STAIRS = { v: [0, 1], '^': [0, -1], '>': [1, 0], '<': [-1, 0] }; // the way the floor goes down
const WALK = new Set(['.', '_', '!', ':', '~', 'S', 'E', ...Object.keys(STAIRS)]);
export const KNOWN = new Set(['#', 'n', '=', '|', 'b', 't', 'k', ...WALK]);
export const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const TUBE = 3.4; // fluorescent tubes hang this far over the floor

// The header (name:, and ; comments) and the grid's lines as written.
export function readLines(text) {
  let name = 'STATION';
  const grid = [];
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith(';')) continue;
    const m = /^name:\s*(.+)$/.exec(line);
    if (m && !grid.length) { name = m[1].trim(); continue; }
    grid.push(line);
  }
  return { name, grid };
}

export function parseStation(text) {
  const { name, grid } = readLines(text);
  const rows = grid.length, cols = grid.reduce((m, l) => Math.max(m, l.length), 0);
  const cells = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const ch = grid[r][c] ?? '#'; // a short row is padded with wall (the checker reports it)
    cells.push({ c, r, ch, walk: WALK.has(ch), level: ch in FIXED ? FIXED[ch] : null, stair: null });
  }
  const at = (c, r) => (c >= 0 && r >= 0 && c < cols && r < rows ? cells[r * cols + c] : null);

  // Neutral tiles take a neighbour's level, spreading until nothing changes.
  for (let changed = true; changed;) {
    changed = false;
    for (const cell of cells) {
      if (!NEUTRAL.has(cell.ch) || cell.level != null) continue;
      for (const [dc, dr] of N4) {
        const n = at(cell.c + dc, cell.r + dr);
        if (n && n.level != null && !(n.ch in STAIRS)) { cell.level = n.level; changed = true; break; }
      }
    }
  }

  // Stairs: a run of one arrow along its direction. The floor goes from the level behind the run to the one
  // in front of it.
  for (const cell of cells) {
    if (!(cell.ch in STAIRS) || cell.stair) continue;
    const [dx, dz] = STAIRS[cell.ch];
    let sc = cell.c, sr = cell.r;
    while (at(sc - dx, sr - dz)?.ch === cell.ch) { sc -= dx; sr -= dz; }
    let len = 0;
    while (at(sc + dx * len, sr + dz * len)?.ch === cell.ch) len++;
    const behind = at(sc - dx, sr - dz), front = at(sc + dx * len, sr + dz * len);
    const start = dx > 0 ? sc : dx < 0 ? sc + 1 : dz > 0 ? sr : sr + 1; // the run's back edge, in world units
    const stair = { dx, dz, start, len, from: behind?.level ?? null, to: front?.level ?? null };
    for (let k = 0; k < len; k++) { const s = at(sc + dx * k, sr + dz * k); s.stair = stair; s.level = stair.from ?? stair.to; }
  }

  const levelAt = (x, z) => {
    const cell = at(Math.floor(x), Math.floor(z));
    if (!cell) return null;
    const s = cell.stair;
    if (s && s.from != null && s.to != null) {
      const along = s.dx ? (x - s.start) * s.dx : (z - s.start) * s.dz; // 0 at the back edge, len at the front
      return s.from + (s.to - s.from) * Math.min(1, Math.max(0, along / s.len));
    }
    return cell.level;
  };
  const solidAt = (x, z) => { const cell = at(Math.floor(x), Math.floor(z)); return !cell || !cell.walk; };
  const centre = (cell) => ({ x: cell.c + 0.5, z: cell.r + 0.5 });

  // Tubes: along the middle row of each platform band every 5 columns, and on a 4-tile grid over the hall.
  const tubes = [];
  for (const band of bands((r) => grid[r].includes('_'), rows)) {
    const mid = Math.round((band[0] + band.at(-1)) / 2);
    for (let c = 2; c < cols; c += 5) {
      const cell = at(c, mid);
      if (cell && cell.level != null && (cell.ch === '_' || cell.ch === '|')) tubes.push({ x: c + 0.5, y: cell.level + TUBE, z: mid + 0.5 });
    }
  }
  for (const cell of cells) if (cell.ch === '.' && cell.c % 4 === 2 && cell.r % 4 === 1) tubes.push({ x: cell.c + 0.5, y: cell.level + TUBE, z: cell.r + 0.5 });

  const tracks = bands((r) => grid[r].includes('='), rows).map((b) => ({ z0: b[0], z1: b.at(-1) + 1, z: (b[0] + b.at(-1) + 1) / 2, y: LEVEL.track }));
  const spawn = cells.find((cell) => cell.ch === 'S');
  return {
    name, cols, rows, cells, at, levelAt, solidAt, tubes, tracks,
    spawn: spawn ? centre(spawn) : null,
    exits: cells.filter((cell) => cell.ch === 'E').map(centre),
    signs: cells.filter((cell) => cell.ch === 'n').map(centre),
  };
}

// Runs of consecutive rows that pass `test`, as arrays of row numbers.
function bands(test, rows) {
  const out = [];
  let cur = null;
  for (let r = 0; r < rows; r++) {
    if (test(r)) (cur ||= []).push(r);
    else if (cur) { out.push(cur); cur = null; }
  }
  if (cur) out.push(cur);
  return out;
}
