// The turnstiles (station spec, "Life and props (round 2)"): a ticket gets you in, leaving is free. Pure: no
// three.js, no DOM, so the tests drive it. In-game money only, in cents, kept for the visit.
//
// The gates are the map's `:` tiles. Coming from the west (the hall side, x below the gate's column) a gate is shut
// unless you hold a ticket; from the east it opens for anyone. A single is used up once you're through to the east;
// a day pass lasts the visit.
import { RADIUS } from './move.js';

export const PRICES = { single: 290, day: 700 };
export const KINDS = ['single', 'day'];
export const NAMES = { single: 'single', day: 'day pass' };
export const START = 2000, TOP_UP = 2000;
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const TOUCH = 0.12; // this close (a blocked step stops you up to one step short) to a shut gate's face counts as walking into it

export function createGates(map) {
  const cells = map.cells.filter((c) => c.ch === ':');
  // The gate line: each gate's column. A map may have more than one column of gates; each gate keeps its own.
  const gates = cells.map((c) => ({ c: c.c, r: c.r, x: c.c + 0.5, z: c.r + 0.5, open: 0 }));
  return { gates, wallet: START, pass: null, used: 0, through: null };
}

const gateAt = (g, x, z) => g.gates.find((k) => k.c === Math.floor(x) && k.r === Math.floor(z)) || null;
export const hasTicket = (g) => g.pass === 'single' || g.pass === 'day';

// Is the gate tile at (x, z) shut for this walker? Only while you're wholly west of it with no ticket: once any part
// of you is in it you're already going through (or coming back from the platform side), so it never closes on you.
export function shutFor(g, gate, w) {
  if (hasTicket(g)) return false;
  return w.x + RADIUS <= gate.c + 1e-6;
}

// The map as the walker sees it: the shut gates are solid.
export function gatedMap(map, g, w) {
  return {
    ...map,
    solidAt(x, z) {
      if (map.solidAt(x, z)) return true;
      const gate = gateAt(g, x, z);
      return !!gate && shutFor(g, gate, w);
    },
  };
}

// Call once a frame after the walker moves. Keeps track of who's going through which gate: a single is used up
// when you come out of a gate on its east side; walking back out west keeps it.
export function trackGates(g, w) {
  const inside = g.gates.find((k) => w.x + RADIUS > k.c && w.x - RADIUS < k.c + 1 && Math.abs(w.z - k.z) < 0.5) || null;
  if (inside) g.through = inside;
  else if (g.through) {
    const k = g.through;
    if (w.x - RADIUS >= k.c + 1 - 1e-6 && g.pass === 'single') { g.pass = null; g.used++; }
    g.through = null;
  }
  return inside;
}

// Are you pushing into a shut gate from the hall? Then the ticket machine opens.
export function bumped(g, w, input) {
  if (hasTicket(g) || !(input.x > 0.3)) return null;
  const gate = g.gates.find((k) => Math.abs(w.z - k.z) < 0.5 && w.x + RADIUS <= k.c + 1e-6 && w.x + RADIUS >= k.c - TOUCH);
  return gate || null;
}

export function buy(g, kind) {
  const price = PRICES[kind];
  if (price == null) return { ok: false, reason: 'unknown' };
  if (g.pass === 'day') return { ok: true, already: true };
  if (g.wallet < price) return { ok: false, reason: 'funds' };
  g.wallet -= price;
  g.pass = kind;
  return { ok: true };
}

export function topUp(g) { g.wallet += TOP_UP; return g.wallet; }

// How open each gate's arm should be (0 shut … 1 open), eased toward its target. A gate opens for you when you're in
// it or about to be (within reach ahead, in its row) and allowed through that way.
export function easeArms(g, w, dt, reach = 1) {
  for (const k of g.gates) {
    const inRow = Math.abs(w.z - k.z) < 0.55;
    const dx = w.x - k.x;
    const near = inRow && Math.abs(dx) < reach;
    const allowed = dx > 0 || hasTicket(g) || !shutFor(g, k, w);
    const want = near && allowed ? 1 : 0;
    const rate = want ? 7 : 3; // snaps open, swings shut
    k.open += (want - k.open) * (1 - Math.exp(-dt * rate));
    if (Math.abs(want - k.open) < 1e-3) k.open = want;
  }
}
