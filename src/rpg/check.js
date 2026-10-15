// Checks a station map (station spec §3) and says what's wrong, by row and column, so whoever drew it
// (a person or a model) can fix it. `node src/rpg/check.js [file]` checks a file from the command line.
import { parseStation, readLines, KNOWN, STAIRS, N4 } from './map.js';

export function checkStation(text) {
  const errors = [];
  const err = (row, col, msg) => errors.push({ row, col, msg });
  const { grid } = readLines(text);
  const map = parseStation(text);
  const key = (cell) => cell.r * map.cols + cell.c;

  grid.forEach((line, r) => {
    if (line.length !== map.cols) err(r, line.length, `row is ${line.length} wide; the widest is ${map.cols}`);
    [...line].forEach((ch, c) => { if (!KNOWN.has(ch)) err(r, c, `unknown tile '${ch}'`); });
  });

  const spawns = map.cells.filter((cell) => cell.ch === 'S');
  if (spawns.length !== 1) err(spawns[1]?.r ?? 0, spawns[1]?.c ?? 0, `there must be exactly one S (found ${spawns.length})`);
  if (!map.exits.length) err(0, 0, 'there is no E: no way back up to the museum');

  if (spawns.length) {
    const seen = new Set([key(spawns[0])]);
    const queue = [spawns[0]];
    while (queue.length) {
      const cell = queue.pop();
      for (const [dc, dr] of N4) {
        const n = map.at(cell.c + dc, cell.r + dr);
        if (n && n.walk && !seen.has(key(n))) { seen.add(key(n)); queue.push(n); }
      }
    }
    for (const cell of map.cells) if (cell.walk && !seen.has(key(cell))) err(cell.r, cell.c, `'${cell.ch}' cannot be reached from S`);
  }

  const runs = new Set();
  for (const cell of map.cells) {
    const s = cell.stair;
    if (!s || runs.has(s)) continue;
    runs.add(s);
    if (s.from == null || s.to == null) err(cell.r, cell.c, 'these stairs need floor at both ends of the run');
    else if (!(s.from > s.to)) err(cell.r, cell.c, `these stairs must go down in the arrow's direction (they go from ${s.from} to ${s.to})`);
  }
  for (const cell of map.cells) {
    if (!cell.stair) continue;
    const [dx, dz] = STAIRS[cell.ch];
    for (const side of [1, -1]) {
      const n = map.at(cell.c + dz * side, cell.r + dx * side);
      if (n && n.walk && n.ch !== cell.ch) err(n.r, n.c, 'floor beside a stair run: wall it off or make it part of the stairs');
    }
  }
  for (const cell of map.cells) {
    if (cell.walk && !cell.stair && cell.level == null) err(cell.r, cell.c, 'this tile has no floor level: put floor beside it');
  }
  for (const cell of map.cells) {
    if (!cell.walk || cell.stair || cell.level == null) continue;
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const n = map.at(cell.c + dc, cell.r + dr);
      if (n && n.walk && !n.stair && n.level != null && Math.abs(n.level - cell.level) > 0.01) err(n.r, n.c, 'a drop between two floors: put stairs or a wall here');
    }
  }

  grid.forEach((line, r) => {
    if (!line.includes('=')) return;
    const bad = [...line.padEnd(map.cols, '#')].findIndex((ch) => ch !== '=');
    if (bad >= 0) err(r, bad, 'a track row must be = from edge to edge');
  });
  for (const t of map.tracks) {
    const edged = [t.z0 - 1, t.z1].some((r) => grid[r] && grid[r].includes('!'));
    if (!edged) err(t.z0, 0, 'this track has no platform edge (!) beside it');
  }
  for (const cell of map.cells) {
    if (cell.ch !== '!') continue;
    if (!N4.some(([dc, dr]) => map.at(cell.c + dc, cell.r + dr)?.ch === '=')) err(cell.r, cell.c, "'!' must be next to the track (=)");
  }

  return errors.sort((a, b) => a.row - b.row || a.col - b.col);
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('check.js')) {
  const { readFileSync } = await import('node:fs');
  const file = process.argv[2] || new URL('./station.txt', import.meta.url);
  const errors = checkStation(readFileSync(file, 'utf8'));
  for (const e of errors) console.log(`row ${e.row}, col ${e.col}: ${e.msg}`);
  console.log(errors.length ? `${errors.length} problem${errors.length === 1 ? '' : 's'}` : 'ok');
  process.exitCode = errors.length ? 1 : 0;
}
