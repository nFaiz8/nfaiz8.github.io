// The city either side of the bridge (subway ride spec §5; Faiz: "make it look like Manhattan"). Pure: the layout only,
// bridge.js draws it. Looking north up the East River from the bridge: Manhattan on the left (west), an island narrow at
// its southern tip just behind the bridge and widening north, the Hudson past its far side; Brooklyn on the right,
// lower. Both on street grids: avenues run up the island (along z), streets across it (along x), and every building
// stands inside a block.
//
// The city is a miniature (a tile is far more than a metre out here), so it fits in the fog: the island runs about
// 1800 tiles north and 650 across.
import { rng } from './life.js';

export const MANHATTAN = { east: 350, tip: 260, north: -1500, width: 650 };
export const BROOKLYN = { west: 550, east: 1100, south: 400, north: -1200 };
export const CORRIDOR = [-25, 45]; // the line's tracks, and room either side

// The island's west shore (the Hudson) at z: nothing at the tip, widening northward.
export function manhattanWest(z) {
  if (z >= MANHATTAN.tip) return MANHATTAN.east;
  return MANHATTAN.east - Math.min(MANHATTAN.width, 470 * Math.sqrt((MANHATTAN.tip - z) / 460));
}

// Each borough's grid: blocks ax wide (along x, an avenue between) and sz deep (along z, a street between), from ox, oz.
export const GRID = {
  manhattan: { ox: MANHATTAN.east, ax: 32, avenue: 5, oz: 0, sz: 12, street: 3 },
  brooklyn: { ox: BROOKLYN.west, ax: 26, avenue: 4, oz: 3, sz: 14, street: 3 },
};

// How tall Manhattan builds at z: the Financial District at the tip, low Chinatown and the Lower East Side by the
// bridge, the Village a little taller, Midtown's towers, then uptown.
function manhattanHeight(z, r) {
  if (z > 60) return 50 + r() * 90;
  if (z > -400) return r() < 0.05 ? 40 + r() * 25 : 8 + r() * 22;
  if (z > -700) return 15 + r() * 30;
  if (z > -1100) return (50 + r() * 110) * (r() < 0.12 ? 1.6 : 1);
  return 20 + r() * 35;
}
function brooklynHeight(x, z, r) {
  if (z > 60 && z < 300 && x < 800 && r() < 0.35) return 30 + r() * 50; // Downtown Brooklyn's few towers
  return 5 + r() * 12;
}

// Landmarks, each a stack of tiers (setbacks) from the ground up: [w, d, h] with h the top of that tier.
const LANDMARKS = [
  { name: 'empire', x: 190, z: -850, tiers: [[30, 30, 110], [20, 20, 160], [9, 9, 185], [1.6, 1.6, 235]] },
  { name: 'chrysler', x: 270, z: -930, tiers: [[24, 24, 130], [14, 14, 160], [8, 8, 182], [1.2, 1.2, 218]] },
  { name: 'wtc', x: 250, z: 150, tiers: [[30, 30, 250], [1.6, 1.6, 325]] },
];

export function buildCity(seed = 42) {
  const r = rng(seed), lots = [];
  const nearLandmark = (x, z) => LANDMARKS.some((l) => Math.abs(l.x - x) < 26 && Math.abs(l.z - z) < 20);
  // The line runs underground to the bridge along z 0…19: nothing is built over it, or towers would rise through the
  // tunnels and the bridge's approaches.
  const overLine = (z0, z1) => z1 > CORRIDOR[0] && z0 < CORRIDOR[1];
  // A block's lots: split along x into n, each a little in from its neighbours.
  const block = (borough, g, bx, bz, n, height, inside) => {
    const x0 = g.ox + bx * g.ax + g.avenue / 2, x1 = g.ox + (bx + 1) * g.ax - g.avenue / 2;
    const z0 = g.oz + bz * g.sz + g.street / 2, z1 = g.oz + (bz + 1) * g.sz - g.street / 2;
    const w = (x1 - x0) / n;
    for (let i = 0; i < n; i++) {
      const a = x0 + i * w + 0.3, b = x0 + (i + 1) * w - 0.3;
      if (!inside(a, b, z0, z1) || nearLandmark((a + b) / 2, (z0 + z1) / 2) || overLine(z0, z1)) continue;
      lots.push({ borough, x: (a + b) / 2, z: (z0 + z1) / 2, w: b - a, d: z1 - z0, h: height((a + b) / 2, (z0 + z1) / 2) });
    }
  };
  const m = GRID.manhattan;
  for (let bz = Math.ceil((MANHATTAN.north - m.oz) / m.sz); (bz + 1) * m.sz + m.oz <= MANHATTAN.tip; bz++) {
    for (let bx = -1; m.ox + bx * m.ax > MANHATTAN.east - MANHATTAN.width - m.ax; bx--) {
      block('manhattan', m, bx, bz, 1 + Math.floor(r() * 2), (x, z) => manhattanHeight(z, r),
        (a, b, z0, z1) => a >= manhattanWest(z1) && b <= MANHATTAN.east);
    }
  }
  const k = GRID.brooklyn;
  for (let bz = Math.ceil((BROOKLYN.north - k.oz) / k.sz); (bz + 1) * k.sz + k.oz <= BROOKLYN.south; bz++) {
    for (let bx = 0; k.ox + (bx + 1) * k.ax <= BROOKLYN.east; bx++) {
      block('brooklyn', k, bx, bz, 1, (x, z) => brooklynHeight(x, z, r), (a) => a >= BROOKLYN.west);
    }
  }
  const landmarks = LANDMARKS.map((l) => ({ ...l, h: l.tiers.at(-1)[2] }));
  return { lots, landmarks };
}
