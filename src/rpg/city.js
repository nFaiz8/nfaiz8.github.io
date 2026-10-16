// The city either side of the bridge (subway ride spec §5; Faiz: "make it look like Manhattan", then "not accurate at
// all"): real New York, from real coordinates. Pure: the layout only, bridge.js draws it.
//
// The bridge is the Williamsburg Bridge, which the J/M/Z cross on a lower deck inside its truss, as ours does: from
// Delancey St in Manhattan (west) to Williamsburg (east). The camera looks north up the East River, as from the bridge:
// Manhattan's east side on the left, Midtown's towers ahead-left, Central Park beyond them; Williamsburg, Greenpoint and
// Long Island City on the right; Roosevelt Island and the Queensboro Bridge upriver.
//
// World from the map: the bridge's middle is the bridge piece's middle (x 450, z 9.5); world +x is compass bearing 100°
// (along the bridge, toward Brooklyn) and world −z bearing 10° (up the river). One tile is SCALE metres, across and up.
import { rng } from './life.js';

export const SCALE = 4; // metres a tile
const ORIGIN = { lon: -73.972, lat: 40.7137, x: 450, z: 9.5 };
const MX = 111320 * Math.cos((ORIGIN.lat * Math.PI) / 180), MY = 110540; // metres a degree of longitude, of latitude
const ALONG = (100 * Math.PI) / 180; // the bridge's bearing
// Metres east and north of the origin → world x, z.
export function toWorld(e, n) {
  const u = e * Math.sin(ALONG) + n * Math.cos(ALONG); // along the bridge
  const w = e * Math.cos(ALONG) - n * Math.sin(ALONG); // across it, toward the south
  return { x: ORIGIN.x + u / SCALE, z: ORIGIN.z + w / SCALE };
}
export const metres = (lon, lat) => ({ e: (lon - ORIGIN.lon) * MX, n: (lat - ORIGIN.lat) * MY });
export const lonLat = ([lon, lat]) => { const m = metres(lon, lat); return toWorld(m.e, m.n); };

// Shorelines, [lon, lat], traced from a map (good to a block or so where you can see them).
const MANHATTAN_COAST = [
  [-73.9763, 40.7139], [-73.9740, 40.7180], [-73.9725, 40.7230], [-73.9718, 40.7275], [-73.9727, 40.7310],
  [-73.9732, 40.7345], [-73.9745, 40.7370], [-73.9725, 40.7410], [-73.9705, 40.7445], [-73.9672, 40.7485],
  [-73.9620, 40.7540], [-73.9580, 40.7590], [-73.9530, 40.7640], [-73.9480, 40.7710], [-73.9425, 40.7760],
  [-73.9435, 40.7830], [-73.9380, 40.7880], [-73.9340, 40.7940], [-73.9330, 40.8000], [-73.9340, 40.8100],
  [-73.9330, 40.8300], [-73.9210, 40.8550], [-73.9110, 40.8740], [-73.9230, 40.8780], [-73.9300, 40.8720],
  [-73.9420, 40.8600], [-73.9480, 40.8500], [-73.9560, 40.8350], [-73.9620, 40.8200], [-73.9720, 40.8050],
  [-73.9810, 40.7920], [-73.9890, 40.7810], [-73.9950, 40.7720], [-74.0020, 40.7630], [-74.0070, 40.7540],
  [-74.0110, 40.7470], [-74.0110, 40.7380], [-74.0130, 40.7270], [-74.0160, 40.7180], [-74.0190, 40.7100],
  [-74.0170, 40.7020], [-74.0120, 40.7010], [-74.0060, 40.7040], [-74.0010, 40.7070], [-73.9950, 40.7090],
  [-73.9880, 40.7090], [-73.9830, 40.7100], [-73.9792, 40.7110], [-73.9773, 40.7125],
];
// Brooklyn and Queens' western shore, then a wide box east (the rest of Long Island, far off in the haze).
const EAST_COAST = [
  [-73.9990, 40.6960], [-73.9950, 40.7030], [-73.9870, 40.7045], [-73.9780, 40.7010], [-73.9700, 40.7040],
  [-73.9680, 40.7080], [-73.9660, 40.7130], [-73.9640, 40.7180], [-73.9620, 40.7220], [-73.9610, 40.7270],
  [-73.9600, 40.7310], [-73.9585, 40.7350], [-73.9570, 40.7380], [-73.9605, 40.7420], [-73.9590, 40.7460],
  [-73.9550, 40.7500], [-73.9500, 40.7550], [-73.9440, 40.7600], [-73.9380, 40.7680], [-73.9330, 40.7740],
  [-73.9290, 40.7800], [-73.9200, 40.7850], [-73.8000, 40.7850], [-73.8000, 40.6900], [-73.9990, 40.6900],
];
// Roosevelt Island: a long sliver up the river's middle.
const ROOSEVELT = [[-73.9612, 40.7515], [-73.9560, 40.7548], [-73.9475, 40.7635], [-73.9405, 40.7718], [-73.9393, 40.7708], [-73.9460, 40.7622], [-73.9548, 40.7535], [-73.9600, 40.7505]];
export const SHORES = { manhattan: MANHATTAN_COAST.map(lonLat), east: EAST_COAST.map(lonLat), roosevelt: ROOSEVELT.map(lonLat) };

export function inPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.z > p.z) !== (b.z > p.z) && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

// Manhattan's grid (the Commissioners' Plan): avenues run 29° east of true north, streets across them. Positions in
// metres from 5th Ave & 59th St: avenues east (+) and west (−) of 5th Ave along the streets; street numbers along the
// avenues, about 80 m apart. Brooklyn and Queens' grids near the water run about the same way.
const GRID_BEARING = (29 * Math.PI) / 180;
const AV = { e: Math.sin(GRID_BEARING), n: Math.cos(GRID_BEARING) }, ST = { e: Math.cos(GRID_BEARING), n: -Math.sin(GRID_BEARING) };
const FIFTH_59 = metres(-73.9730, 40.7644);
const STREET = 80; // metres, street to street
// Manhattan's avenues, metres east of 5th Ave: York, 1st, 2nd, 3rd, Lex, Park, Madison, 5th, 6th, 7th, 8th … 12th.
export const AVENUES = [1250, 1000, 750, 500, 375, 250, 125, 0, -280, -560, -840, -1120, -1400, -1680, -1960, -2240].sort((a, b) => a - b);
// The world yaw of the grid: a box's x axis along the streets.
const stW = toWorld(FIFTH_59.e + ST.e * 1000, FIFTH_59.n + ST.n * 1000), st0 = toWorld(FIFTH_59.e, FIFTH_59.n);
export const GRID_YAW = -Math.atan2(stW.z - st0.z, stW.x - st0.x);

// A point in grid terms: metres east of 5th Ave (along the streets) and the street number.
export function gridOf(e, n) {
  const de = e - FIFTH_59.e, dn = n - FIFTH_59.n;
  return { u: de * ST.e + dn * ST.n, street: 59 + (de * AV.e + dn * AV.n) / STREET };
}
// Back: a grid point to metres east and north.
function fromGrid(u, street) {
  const a = (street - 59) * STREET;
  return { e: FIFTH_59.e + u * ST.e + a * AV.e, n: FIFTH_59.n + u * ST.n + a * AV.n };
}

// Central Park: 59th to 110th, 5th Ave to 8th Ave (Central Park West).
export const PARK = { streets: [59.4, 109.6], u: [-840 + 15, -15] };
export const parkCorners = () => [[PARK.u[0], PARK.streets[0]], [PARK.u[1], PARK.streets[0]], [PARK.u[1], PARK.streets[1]], [PARK.u[0], PARK.streets[1]]]
  .map(([u, s]) => { const m = fromGrid(u, s); return toWorld(m.e, m.n); });

// How tall Manhattan builds, in metres, by street and avenue (u): the low East Village and Lower East Side, Stuy Town's
// even slabs, Kips Bay and Murray Hill, Midtown, Hudson Yards, the Upper East and West Sides, Harlem.
function manhattanHeight(street, u, r) {
  if (street < 14) return r() < 0.06 ? 50 + r() * 60 : 14 + r() * 14;
  if (street < 21 && u > 700) return 40; // Stuyvesant Town
  if (street < 34) return u < -1100 && street > 29 ? 150 + r() * 240 : 30 + r() * (u > 0 ? 80 : 50);
  if (street < 60) return (street > 55 && street < 58 && u < 0 && u > -900 && r() < 0.3 ? 2.2 : 1) * (60 + r() * 150);
  if (street < 97) return 30 + r() * 90;
  return 15 + r() * 30;
}
// Long Island City's towers, Williamsburg's waterfront, otherwise low brick.
function eastHeight(lon, lat, r) {
  if (lat > 40.742 && lat < 40.752 && lon > -73.962 && r() < 0.45) return 60 + r() * 120;
  if (lat > 40.716 && lat < 40.724 && lon < -73.958 && r() < 0.5) return 60 + r() * 80;
  return 10 + r() * 14;
}

// The landmarks, at their places, each a stack of tiers [w, d, h] in metres (h the top of that tier).
const LANDMARKS = [
  { name: 'empire', at: [-73.9857, 40.7484], tiers: [[58, 58, 85], [42, 42, 320], [18, 18, 381], [4, 4, 443]] },
  { name: 'chrysler', at: [-73.9755, 40.7516], tiers: [[60, 60, 80], [36, 36, 240], [22, 22, 282], [3, 3, 319]] },
  { name: 'one vanderbilt', at: [-73.9787, 40.7530], tiers: [[55, 40, 300], [30, 24, 390], [3, 3, 427]] },
  { name: '432 park', at: [-73.9719, 40.7616], tiers: [[28, 28, 426]] },
  { name: 'central park tower', at: [-73.9810, 40.7663], tiers: [[40, 30, 472]] },
  { name: 'steinway', at: [-73.9775, 40.7650], tiers: [[20, 18, 400], [12, 12, 435]] },
  { name: 'un', at: [-73.9680, 40.7493], tiers: [[87, 22, 155]] },
  { name: 'citigroup', at: [-73.9706, 40.7584], tiers: [[48, 48, 279]] },
  { name: 'skyline tower', at: [-73.9384, 40.7488], tiers: [[36, 30, 237]] },
  { name: 'one court square', at: [-73.9437, 40.7470], tiers: [[40, 30, 205]] },
].map((l) => ({ ...l, ...lonLat(l.at), h: l.tiers.at(-1)[2] / SCALE }));

// The line runs underground to the bridge along z 0…19: nothing is built over it.
export const CORRIDOR = [-25, 45];
const REACH = 3200; // tiles: nothing past this far north is built (it's beyond the haze)

// The city: lots [{ borough, x, z, w, d, h, yaw }] in tiles (x, z the middle at the ground; w along the streets),
// and the landmarks.
export function buildCity(seed = 42) {
  const r = rng(seed), lots = [];
  const nearLandmark = (p) => LANDMARKS.some((l) => Math.hypot(l.x - p.x, l.z - p.z) < 22);
  const usable = (c) => c.z > ORIGIN.z - REACH && !(c.z > CORRIDOR[0] && c.z < CORRIDOR[1]) && !nearLandmark(c);
  // Every block of a grid: between avenues (or every AVW metres) and between streets; lots along the street.
  const blocks = (borough, avenues, streets, coast, height, perBlock) => {
    for (let i = 0; i + 1 < avenues.length; i++) {
      const u0 = avenues[i] + 15, u1 = avenues[i + 1] - 15; // avenues ~30 m wide
      for (const s of streets) {
        const n = perBlock(u1 - u0);
        const lw = (u1 - u0) / n;
        for (let k = 0; k < n; k++) {
          const a = u0 + k * lw + 1.5, b = u0 + (k + 1) * lw - 1.5, s0 = s + 0.12, s1 = s + 0.88; // streets ~18 m wide
          const corners = [[a, s0], [b, s0], [b, s1], [a, s1]].map(([u, st]) => { const m = fromGrid(u, st); return toWorld(m.e, m.n); });
          if (!corners.every((c) => inPolygon(c, coast))) continue;
          const mid = fromGrid((a + b) / 2, (s0 + s1) / 2), c = toWorld(mid.e, mid.n);
          if (!usable(c)) continue;
          if (borough === 'manhattan' && (s0 + s1) / 2 > PARK.streets[0] && (s0 + s1) / 2 < PARK.streets[1] && (a + b) / 2 > PARK.u[0] - 15 && (a + b) / 2 < PARK.u[1] + 15) continue;
          const g = { u: (a + b) / 2, street: (s0 + s1) / 2, lon: ORIGIN.lon + mid.e / MX, lat: ORIGIN.lat + mid.n / MY };
          lots.push({ borough, x: c.x, z: c.z, w: (b - a) / SCALE, d: ((s1 - s0) * STREET) / SCALE, h: height(g, r) / SCALE, yaw: GRID_YAW });
        }
      }
    }
  };
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);
  // Manhattan from Grand St (about −10) to 125th.
  blocks('manhattan', AVENUES, range(-12, 125), SHORES.manhattan, (g, r) => manhattanHeight(g.street, g.u, r), (w) => Math.max(1, Math.round(w / 60)));
  // Brooklyn and Queens across the river: the same grid's lines, blocks every 180 m.
  blocks('east', range(0, 26).map((i) => 1300 + i * 180), range(-10, 70), SHORES.east, (g, r) => eastHeight(g.lon, g.lat, r), (w) => Math.max(1, Math.round(w / 45)));
  return { lots, landmarks: LANDMARKS };
}
