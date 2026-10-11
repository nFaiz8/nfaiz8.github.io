// Shortest 4-way path over a grid. passable(x, y) → boolean.
// Returns the cells after start up to and including goal, [] if start is goal, or null.
export function findPath(w, h, passable, sx, sy, gx, gy, maxNodes = 200000) {
  if (sx === gx && sy === gy) return [];
  if (gx < 0 || gy < 0 || gx >= w || gy >= h || !passable(gx, gy)) return null;
  const prev = new Int32Array(w * h).fill(-1);
  const start = sy * w + sx;
  prev[start] = start;
  const queue = new Int32Array(w * h);
  let head = 0, tail = 0, seen = 0;
  queue[tail++] = start;
  const goal = gy * w + gx;
  while (head < tail && seen++ < maxNodes) {
    const cur = queue[head++];
    if (cur === goal) break;
    const cx = cur % w, cy = (cur / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (prev[ni] !== -1 || !passable(nx, ny)) continue;
      prev[ni] = cur;
      queue[tail++] = ni;
    }
  }
  if (prev[goal] === -1) return null;
  const out = [];
  for (let c = goal; c !== start; c = prev[c]) out.push({ x: c % w, y: (c / w) | 0 });
  return out.reverse();
}
