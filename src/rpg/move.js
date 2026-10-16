// Walking in the station (station spec §4): free movement that's tight, not floaty. Pure: no three.js.
// w = { x, z, y, vx, vz, facing, walked }; input = { x, y, run }, x east and y south, each −1…1 (the museum's keys).
export const SPEED = 4.2, SPRINT = 1.6, ACCEL = 0.04, RADIUS = 0.25, NUDGE = 0.2;
const STEP = 0.1; // the longest move checked at once, so a slow frame never passes through a wall

export function createWalker(map, at = map.spawn) {
  return { x: at.x, z: at.z, y: map.levelAt(at.x, at.z) ?? 0, vx: 0, vz: 0, facing: 1, walked: 0 };
}

export function stepWalker(w, dt, input, map) {
  let ix = input.x || 0, iz = input.y || 0;
  const len = Math.hypot(ix, iz);
  if (len > 1) { ix /= len; iz /= len; }
  const top = SPEED * (input.run ? SPRINT : 1);
  const k = 1 - Math.exp(-dt / ACCEL);
  w.vx += (ix * top - w.vx) * k;
  w.vz += (iz * top - w.vz) * k;
  if (!ix && Math.abs(w.vx) < 0.05) w.vx = 0;
  if (!iz && Math.abs(w.vz) < 0.05) w.vz = 0;
  const x0 = w.x, z0 = w.z;
  const n = Math.max(1, Math.ceil(Math.hypot(w.vx, w.vz) * dt / STEP));
  for (let i = 0; i < n; i++) {
    slide(w, (w.vx * dt) / n, 'x', map);
    slide(w, (w.vz * dt) / n, 'z', map);
  }
  if (ix) w.facing = Math.sign(ix);
  w.walked += Math.hypot(w.x - x0, w.z - z0);
  w.y = map.levelAt(w.x, w.z) ?? w.y;
  return w;
}

// Does a circle at (x, z) overlap a solid cell or leave the map? Cells are 1 × 1 tiles, or map.grain on a side (a
// train's floor plan is finer than a station's tiles).
export function blocked(map, x, z, r = RADIUS) {
  const g = map.grain || 1;
  for (let row = Math.floor((z - r) / g); row <= Math.floor((z + r) / g); row++) {
    for (let col = Math.floor((x - r) / g); col <= Math.floor((x + r) / g); col++) {
      if (!map.solidAt((col + 0.5) * g, (row + 0.5) * g)) continue;
      const nx = Math.max(col * g, Math.min(x, (col + 1) * g)), nz = Math.max(row * g, Math.min(z, (row + 1) * g));
      if ((x - nx) ** 2 + (z - nz) ** 2 < r * r - 1e-9) return true;
    }
  }
  return false;
}

// Move along one axis. Against a wall that axis stops, and you slide along it on the other. A corner clipped
// by less than NUDGE eases you sideways round it instead (as the museum does).
function slide(w, d, axis, map) {
  if (!d) return;
  const nx = axis === 'x' ? w.x + d : w.x, nz = axis === 'z' ? w.z + d : w.z;
  if (!blocked(map, nx, nz)) { w.x = nx; w.z = nz; return; }
  for (let o = 0.05; o <= NUDGE + 1e-9; o += 0.05) {
    for (const s of [1, -1]) {
      const ox = axis === 'z' ? s * o : 0, oz = axis === 'x' ? s * o : 0;
      if (blocked(map, nx + ox, nz + oz)) continue;
      const m = Math.min(Math.abs(d), o); // ease sideways by no more than the move
      const tx = w.x + Math.sign(ox) * m, tz = w.z + Math.sign(oz) * m;
      if (!blocked(map, tx, tz)) { w.x = tx; w.z = tz; }
      return;
    }
  }
  if (axis === 'x') w.vx = 0; else w.vz = 0;
}
