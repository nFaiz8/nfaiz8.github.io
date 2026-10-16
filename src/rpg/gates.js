// The turnstiles (station spec, "Life and props (round 2)"): New York style, a fare gets you in, leaving is free.
// Pure: no three.js, no DOM, so the tests drive it. In-game money only, in cents, kept for the visit.
//
// The gates are the map's `:` tiles. Coming from the west (the hall side, x below the gate's column) a gate is shut
// unless you hold a ticket; from the east it opens for anyone. A single ride is used up once you're through to the
// east; an unlimited ride lasts the visit. Each gate has a three-armed rotor that you turn a third of a turn by
// walking through (turnRotors), and a tap target whose light ring says what's going on (ringState).
//
// The northernmost gate of each column of two or more is the emergency exit instead (kind 'emergency'): exit only and
// free. From the hall it's locked whether or not you hold a ticket, and walking into it doesn't open the fare card
// machine; from the platform you push it open (swingGates) and walk out free, and the alarm goes (alarmOn).
import { RADIUS } from './move.js';

export const PRICES = { single: 290, unlimited: 700 };
export const KINDS = ['single', 'unlimited'];
export const NAMES = { single: 'single ride', unlimited: 'unlimited ride' };
export const START = 2000, TOP_UP = 2000;
export const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const TOUCH = 0.12; // this close (a blocked step stops you up to one step short) to a shut gate's face counts as walking into it

// Each column of gates' northernmost gate is its emergency exit, if the column has another gate to pay at. (From the
// camera, south of the line looking north, a rotor only shows on the cabinet north of its lane, so the paid lanes are
// the ones with a post north of them, and the lane against the north wall is the one without an arm.)
export function gateKinds(map) {
  const cells = map.cells.filter((c) => c.ch === ':');
  const north = new Map(), count = new Map();
  for (const c of cells) {
    count.set(c.c, (count.get(c.c) || 0) + 1);
    if (!north.has(c.c) || c.r < north.get(c.c)) north.set(c.c, c.r);
  }
  return cells.map((c) => (count.get(c.c) > 1 && north.get(c.c) === c.r ? 'emergency' : 'turnstile'));
}

export function createGates(map) {
  const cells = map.cells.filter((c) => c.ch === ':'), kinds = gateKinds(map);
  // The gate line: each gate's column. A map may have more than one column of gates; each gate keeps its own.
  // turns: the rotor's rest position, in thirds of a turn (east positive); push: how far you've pushed it from
  // there (−1…1); dir: which way you're going through (+1 east, −1 west, 0 not in it). swing: how far the
  // emergency gate stands open toward the hall (0 shut … 1 a quarter turn, against the wall).
  const gates = cells.map((c, i) => ({ c: c.c, r: c.r, x: c.c + 0.5, z: c.r + 0.5, kind: kinds[i], open: 0, turns: 0, push: 0, dir: 0, swing: 0 }));
  // note: a gate you just walked into while it was locked, for its red light; alarm: the emergency gate sounding.
  return { gates, wallet: START, pass: null, used: 0, through: null, note: null, alarm: null };
}
export const isEmergency = (k) => k.kind === 'emergency';

const gateAt = (g, x, z) => g.gates.find((k) => k.c === Math.floor(x) && k.r === Math.floor(z)) || null;
export const hasTicket = (g) => g.pass === 'single' || g.pass === 'unlimited';

// Is the gate tile at (x, z) shut for this walker? Only while you're wholly west of it with no ticket (the emergency
// gate: with or without one): once any part of you is in it you're already going through (or coming back from the
// platform side), so it never closes on you.
export function shutFor(g, gate, w) {
  if (hasTicket(g) && !isEmergency(gate)) return false;
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

// Call once a frame after the walker moves (t: the station's clock, in seconds). Keeps track of who's going through
// which gate: a single is used up when you come out of a turnstile on its east side; walking back out west keeps it.
// Coming out of the emergency gate on its west (hall) side sets the alarm off for ALARM_FOR.
export const ALARM_FOR = 3;
export function trackGates(g, w, t = 0) {
  const inside = g.gates.find((k) => w.x + RADIUS > k.c && w.x - RADIUS < k.c + 1 && Math.abs(w.z - k.z) < 0.5) || null;
  if (inside) g.through = inside;
  else if (g.through) {
    const k = g.through;
    if (isEmergency(k)) { if (w.x + RADIUS <= k.c + 1e-6) g.alarm = { gate: k, from: t, until: t + ALARM_FOR }; }
    else if (w.x - RADIUS >= k.c + 1 - 1e-6 && g.pass === 'single') { g.pass = null; g.used++; }
    g.through = null;
  }
  return inside;
}
export const alarmOn = (g, k, t) => !!g.alarm && g.alarm.gate === k && t >= g.alarm.from && t < g.alarm.until;

// Up against a locked gate from the hall, pushing east: the gate, or null.
function against(g, w, input) {
  if (!(input.x > 0.3)) return null;
  return g.gates.find((k) => Math.abs(w.z - k.z) < 0.5 && w.x + RADIUS <= k.c + 1e-6 && w.x + RADIUS >= k.c - TOUCH && shutFor(g, k, w)) || null;
}
// Are you pushing into a shut turnstile from the hall? Then the ticket machine opens. Never the emergency gate.
export function bumped(g, w, input) {
  const k = against(g, w, input);
  return k && !isEmergency(k) ? k : null;
}
// Are you pushing into the emergency gate from the hall? It stays locked (and its light flashes red a moment).
export function blocked(g, w, input) {
  const k = against(g, w, input);
  return k && isEmergency(k) ? k : null;
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
    if (isEmergency(k)) continue;
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

// The rotor. Its level arm sits ARM_X into the gate tile, halfway along the cabinet (scene.js draws it there). You push it a third of a turn
// over SWEEP of walking once your front reaches it, and the last bit it clicks over by itself (CLICK). Locked, your
// front stops at the tile's edge, short of the arm, so it doesn't move. Going back to the hall you push it from the
// other side and it turns the other way. When you leave the gate, a full push becomes its new rest; a part push
// (you backed out) springs back.
export const ARM_X = 0.5, SWEEP = 0.7, CLICK = 0.85;
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
    if (isEmergency(k)) continue;
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

// The tap target's light ring: 'go' (green) at the gate you're walking up to from the hall while you hold a ticket,
// 'refused' (red) for REFUSED_FOR after you walk into it locked, otherwise 'idle' (dim white). The emergency gate
// has none (null).
export const REFUSED_FOR = 1.2;
// You walked into this gate while it was locked.
export function refused(g, gate, t) { g.note = { gate, from: t, until: t + REFUSED_FOR }; }
export function ringState(g, i, w, t) {
  const k = g.gates[i], n = g.note;
  if (isEmergency(k)) return null;
  if (n && n.gate === k && t >= n.from && t < n.until) return 'refused';
  const coming = Math.abs(w.z - k.z) < 0.5 && w.x > k.c - 1.5 && w.x < k.c + 1 && k.dir >= 0;
  return hasTicket(g) && coming ? 'go' : 'idle';
}

// The emergency gate: a barred panel HINGE_X into its tile, hinged at the wall (the tile's north edge, just inside
// it) and reaching south across the lane. Coming from the platform your front pushes it, and it swings toward the hall
// following you, like the rotor: its angle is where the panel would touch you (atan of how far past the hinge line
// your front is, over how far you are from the hinge), clicking fully open (a quarter turn, against the wall) for the
// last part. It stays open until you're clear of its sweep. From the hall it doesn't move. Once you've left it it swings shut by itself (SHUT_RATE).
export const HINGE_X = 0.12, HINGE_IN = 0.06, SHUT_RATE = 2.5;
const QUARTER = Math.PI / 2;
// How open a walker at (x, z) pushing west has the gate (0 … 1).
export function swingFrom(k, x, z) {
  const hx = k.c + HINGE_X, hz = k.r + HINGE_IN;
  const past = hx - (x - RADIUS);
  if (past <= 0) return 0;
  // Once your middle is past the hinge line the gate is held right open (by the last half step), so you're clear of
  // where it swings shut behind you.
  const p = Math.max(Math.atan2(past, Math.max(0.12, z - RADIUS * 0.6 - hz)) / QUARTER, (hx - x) / 0.5);
  return p >= CLICK ? 1 : p;
}
// How far a turnstile cabinet reaches into the gate tile beside it (turnstiles.js draws them), and the emergency
// panel's length: from the hinge at the north wall across the lane to just short of the face of the cabinet south of
// it, so shut it fills the lane.
export const LANE_IN = 0.08;
export const SWING_LEN = 1 - HINGE_IN - LANE_IN - 0.015;
export function swingGates(g, w, dt) {
  for (const k of g.gates) {
    if (!isEmergency(k)) continue;
    const hx = k.c + HINGE_X;
    const near = Math.abs(w.z - k.z) < 0.5 && w.x + RADIUS > hx - SWING_LEN - 0.05 && w.x - RADIUS < k.c + 1.3;
    if (!near) { k.dir = 0; } else if (!k.dir) k.dir = w.x < hx ? 1 : -1;
    const want = near && k.dir < 0 ? swingFrom(k, w.x, w.z) : 0;
    if (want >= k.swing) k.swing = want; // you push it open as far as you've gone
    else {
      k.swing += (want - k.swing) * (1 - Math.exp(-dt * (near ? 8 : SHUT_RATE)));
      if (k.swing < 1e-3) k.swing = 0;
    }
  }
}
