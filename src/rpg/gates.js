// The turnstiles (station spec, "Life and props (round 2)"): New York style, a fare gets you in, leaving is free.
// Pure: no three.js, no DOM, so the tests drive it. In-game money only, in cents, kept for the visit.
//
// The gates are the map's `:` tiles. Coming from the west (the hall side, x below the gate's column) a gate is shut
// unless you hold a ticket; from the east it opens for anyone. A single ride is used up once you're through to the
// east; an unlimited ride lasts the visit. Each gate has a three-armed rotor that you turn a third of a turn by
// walking through (turnRotors), and a reader whose LED text says what's going on (readerText).
import { RADIUS } from './move.js';

export const PRICES = { single: 290, unlimited: 700 };
export const KINDS = ['single', 'unlimited'];
export const NAMES = { single: 'single ride', unlimited: 'unlimited ride' };
export const START = 2000, TOP_UP = 2000;
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const TOUCH = 0.12; // this close (a blocked step stops you up to one step short) to a shut gate's face counts as walking into it

// seed: picks which taps get the reader's "swipe again" (swipeAgain), so a test can know.
export function createGates(map, seed = 1) {
  const cells = map.cells.filter((c) => c.ch === ':');
  // The gate line: each gate's column. A map may have more than one column of gates; each gate keeps its own.
  // turns: the rotor's rest position, in thirds of a turn (east positive); push: how far you've pushed it from
  // there (−1…1); dir: which way you're going through (+1 east, −1 west, 0 not in it).
  const gates = cells.map((c) => ({ c: c.c, r: c.r, x: c.c + 0.5, z: c.r + 0.5, open: 0, turns: 0, push: 0, dir: 0 }));
  return { gates, wallet: START, pass: null, used: 0, through: null, seed, taps: 0, note: null };
}

const gateAt = (g, x, z) => g.gates.find((k) => k.c === Math.floor(x) && k.r === Math.floor(z)) || null;
export const hasTicket = (g) => g.pass === 'single' || g.pass === 'unlimited';

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
  if (g.pass === 'unlimited') return { ok: true, already: true };
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

// The rotor. Its level arm sits ARM_X into the gate tile (scene.js draws it there). You push it a third of a turn
// over SWEEP of walking once your front reaches it, and the last bit it clicks over by itself (CLICK). Locked, your
// front stops at the tile's edge, short of the arm, so it doesn't move. Going back to the hall you push it from the
// other side and it turns the other way. When you leave the gate, a full push becomes its new rest; a part push
// (you backed out) springs back.
export const ARM_X = 0.1, SWEEP = 0.7, CLICK = 0.85;
const clamp01 = (v) => Math.max(0, Math.min(1, v));
// How far a walker at x has pushed the arm going east (dir 1) or west (dir −1): 0 … 1.
export function pushFrom(k, x, dir) {
  const arm = k.c + ARM_X;
  const p = clamp01(dir > 0 ? (x + RADIUS - arm) / SWEEP : (arm - (x - RADIUS)) / SWEEP);
  return p >= CLICK ? 1 : p;
}
const near = (k, w) => Math.abs(w.z - k.z) < 0.5 && w.x + RADIUS > k.c - 0.3 && w.x - RADIUS < k.c + 1.3;
export function turnRotors(g, w) {
  for (const k of g.gates) {
    if (!near(k, w)) {
      if (Math.abs(k.push) >= 1) k.turns += Math.sign(k.push);
      k.push = 0; k.dir = 0;
      continue;
    }
    if (!k.dir) k.dir = w.x < k.c + ARM_X ? 1 : -1;
    k.push = k.dir * pushFrom(k, w.x, k.dir);
  }
}
// The rotor's angle, in thirds of a turn from where it started (east positive).
export const rotorTurns = (k) => k.turns + k.push;

// The reader's LED text. Idle gates alternate TAP HERE and SWIPE CARD. Holding a ticket, the gate you're walking up
// to from the hall says GO. A note (tapped, refused) shows for a while on its own gate first: the first tap after
// buying says SWIPE AGAIN AT THIS TURNSTILE for a second about one time in four, as New York's do; walking into a
// shut gate says JUST USED once you've used a single, INSUFFICIENT FARE before that.
export const READER = { tap: 'TAP HERE', swipe: 'SWIPE CARD', go: 'GO', again: 'SWIPE AGAIN AT THIS TURNSTILE', used: 'JUST USED', fare: 'INSUFFICIENT FARE' };
export const AGAIN_FOR = 1, REFUSED_FOR = 2.5;

// Does tap n (0, 1, …) of a visit seeded with seed get "swipe again"? One in four, and always the same answer.
export function swipeAgain(seed, n) {
  let h = Math.imul((seed | 0) ^ 0x2c1b3c6d, 0x9e3779b1) ^ Math.imul(n + 1, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return ((h ^ (h >>> 15)) >>> 0) % 4 === 0;
}
// You've just bought a ticket at this gate: the reader takes your tap. Returns whether it asked you to swipe again.
export function tapped(g, gate, t) {
  const again = swipeAgain(g.seed, g.taps++);
  g.note = again ? { gate, key: 'again', from: t, until: t + AGAIN_FOR } : null;
  return again;
}
// You walked into this gate without a ticket.
export function refused(g, gate, t) { g.note = { gate, key: g.used > 0 ? 'used' : 'fare', from: t, until: t + REFUSED_FOR }; }

export function readerText(g, i, w, t) {
  const k = g.gates[i], n = g.note;
  if (n && n.gate === k && t >= n.from && t < n.until) return READER[n.key];
  const coming = Math.abs(w.z - k.z) < 0.5 && w.x > k.c - 1.5 && w.x < k.c + 1 && k.dir >= 0;
  if (hasTicket(g) && coming) return READER.go;
  return i % 2 ? READER.swipe : READER.tap;
}
