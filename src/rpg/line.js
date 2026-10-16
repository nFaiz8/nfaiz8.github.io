// The line (subway ride spec §1): everything below ground as one world along x, made of pieces end to end. Pure.
// MUSEUM's map starts at x = 0, so its map coordinates are line coordinates; every other piece is east of it.
export const STOPS = [
  { name: 'MUSEUM', x: 0, cols: 101, centre: 60 },
  { name: 'CANAL ST', x: 794, cols: 92, centre: 840 },
];
export const PIECES = [
  { kind: 'tunnel', x0: -600, x1: 0 },
  { kind: 'station', stop: 0, x0: 0, x1: 101 },
  { kind: 'tunnel', x0: 101, x1: 330 },
  { kind: 'bridge', x0: 330, x1: 570 },
  { kind: 'tunnel', x0: 570, x1: 794 },
  { kind: 'station', stop: 1, x0: 794, x1: 886 },
  { kind: 'tunnel', x0: 886, x1: 1486 },
];
export const LINE = { x0: PIECES[0].x0, x1: PIECES.at(-1).x1 };
// The tracks' middles (both stations' maps put their track rows here); eastbound on the north track, westbound on
// the south one.
export const TRACKS = [{ i: 0, z: 2.5, dir: 1 }, { i: 1, z: 16.5, dir: -1 }];
// Where expresses are placed (§2): each stretch decides on its own which track an express takes there, or that it
// doesn't run there, so a local standing at one station doesn't stop expresses everywhere. The joins are mid-tunnel,
// over 100 tiles from any platform, where you can't see one appear.
export const STRETCHES = [[-600, -150], [-150, 215], [215, 682], [682, 1000], [1000, 1486]];

export const pieceAt = (x) => PIECES.find((p) => x >= p.x0 && x < p.x1) || (x < LINE.x0 ? PIECES[0] : PIECES.at(-1));

// The bridge's truss (§5): a post every bay, X braces between. Sunlight through a window is cut by the post in front
// of it and dimmed where the braces cross, so a moving train's light strobes.
export const TRUSS = { bay: 8, post: 0.6, brace: 0.5 };
export function trussShade(x) {
  const u = ((x % TRUSS.bay) + TRUSS.bay) % TRUSS.bay;
  if (u < TRUSS.post) return 0;
  return Math.abs(u - TRUSS.bay / 2) < TRUSS.brace ? 0.35 : 1;
}
// How much sun reaches a window at x: all of it on the bridge, easing in over its first and last EASE tiles.
const EASE = 20;
export function sunAt(x) {
  const b = PIECES.find((p) => p.kind === 'bridge');
  const k = Math.min(x - b.x0, b.x1 - x) / EASE;
  return k <= 0 ? 0 : Math.min(1, k);
}
// Tunnel lamps every LAMP tiles: 1 at a lamp, 0 more than a tile and a half from one (the band of light that sweeps
// through a car underground).
export const LAMP = 12;
export function lampAt(x) {
  const d = Math.abs(x - LAMP * Math.round(x / LAMP));
  return d >= 1.5 ? 0 : 1 - d / 1.5;
}
