import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { createWalker, stepWalker, RADIUS } from '../src/rpg/move.js';
import { createGates, gatedMap, trackGates, bumped, buy, topUp, easeArms, hasTicket, PRICES, START, TOP_UP, money } from '../src/rpg/gates.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const GATE_C = 12; // the shipped map's turnstile column

// Walk with input for a while, as index.js does each frame.
function walk(g, w, input, seconds, dt = 1 / 60) {
  const map = gatedMap(MAP, g, w);
  let bumps = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepWalker(w, dt, input, map);
    trackGates(g, w);
    if (bumped(g, w, input)) bumps++;
  }
  return bumps;
}
const at = (x, z) => ({ ...createWalker(MAP), x, z, y: 0 });

test('the shipped map has four gates in one column', () => {
  const g = createGates(MAP);
  assert.deepEqual(g.gates.map((k) => [k.c, k.r]), [[12, 6], [12, 8], [12, 10], [12, 12]]);
  assert.equal(g.wallet, START);
  assert.equal(g.pass, null);
});

test('from the hall without a ticket a gate is shut: you stop at it, and that counts as a bump', () => {
  const g = createGates(MAP), w = at(10.5, 8.5);
  const bumps = walk(g, w, { x: 1, y: 0 }, 1.5);
  assert.ok(w.x + RADIUS <= GATE_C + 1e-6, `stopped west of the gate: ${w.x}`);
  assert.ok(bumps > 0, 'pushing into it is a bump');
  assert.equal(walk(g, w, { x: 0, y: 0 }, 0.2), 0, 'standing still is not');
  assert.equal(walk(g, w, { x: 0, y: 1 }, 0.1), 0, 'walking along it is not');
});

test('a single gets you through once, and is used up on the far side', () => {
  const g = createGates(MAP), w = at(10.5, 8.5);
  assert.deepEqual(buy(g, 'single'), { ok: true });
  assert.equal(g.wallet, START - PRICES.single);
  assert.equal(walk(g, w, { x: 1, y: 0 }, 1), 0);
  assert.ok(w.x > GATE_C + 1 + RADIUS, `through: ${w.x}`);
  assert.equal(g.pass, null);
  assert.equal(g.used, 1);
  // Back west is free.
  walk(g, w, { x: -1, y: 0 }, 1);
  assert.ok(w.x < GATE_C - RADIUS, `back in the hall: ${w.x}`);
  // And east again needs another ticket.
  walk(g, w, { x: 1, y: 0 }, 1);
  assert.ok(w.x + RADIUS <= GATE_C + 1e-6);
});

test('turning back inside a gate keeps your single', () => {
  const g = createGates(MAP), w = at(11.6, 8.5);
  buy(g, 'single');
  walk(g, w, { x: 1, y: 0 }, 0.12); // into the gate
  assert.ok(w.x + RADIUS > GATE_C);
  walk(g, w, { x: -1, y: 0 }, 0.5);
  assert.equal(g.pass, 'single');
});

test('a day pass lasts the visit', () => {
  const g = createGates(MAP), w = at(10.5, 10.5);
  buy(g, 'day');
  for (let i = 0; i < 3; i++) {
    walk(g, w, { x: 1, y: 0 }, 1);
    assert.ok(w.x > GATE_C + 1, `trip ${i}: through`);
    walk(g, w, { x: -1, y: 0 }, 1);
  }
  assert.equal(g.pass, 'day');
  assert.equal(g.wallet, START - PRICES.day);
  assert.deepEqual(buy(g, 'single'), { ok: true, already: true }, 'nothing more to buy');
  assert.equal(g.wallet, START - PRICES.day);
});

test('coming from the platform side is free, and the gate shuts behind you', () => {
  const g = createGates(MAP), w = at(13.6, 6.5);
  walk(g, w, { x: -1, y: 0 }, 1);
  assert.ok(w.x < GATE_C - RADIUS);
  assert.equal(hasTicket(g), false);
  walk(g, w, { x: 1, y: 0 }, 1);
  assert.ok(w.x + RADIUS <= GATE_C + 1e-6, 'shut again from the hall');
});

test('wallet maths: insufficient funds, then a top-up', () => {
  const g = createGates(MAP);
  g.wallet = 250;
  assert.deepEqual(buy(g, 'single'), { ok: false, reason: 'funds' });
  assert.equal(g.wallet, 250);
  assert.equal(g.pass, null);
  assert.equal(topUp(g), 250 + TOP_UP);
  assert.deepEqual(buy(g, 'day'), { ok: true });
  assert.equal(g.wallet, 250 + TOP_UP - PRICES.day);
  assert.deepEqual(buy(g, 'gold'), { ok: false, reason: 'unknown' });
  assert.equal(money(1710), '$17.10');
  assert.equal(money(2000), '$20.00');
});

test('the arms open for you going through and shut after', () => {
  const g = createGates(MAP), w = at(13.3, 8.5);
  easeArms(g, w, 1);
  assert.equal(g.gates[1].open, 1, 'opens for you on the platform side, going out');
  assert.equal(g.gates[0].open, 0, 'not the gate in another row');
  const h = at(11.65, 8.5);
  easeArms(g, h, 3);
  assert.equal(g.gates[1].open, 0, 'shut to you in the hall without a ticket');
  buy(g, 'single');
  easeArms(g, h, 1);
  assert.equal(g.gates[1].open, 1, 'open once you hold one');
  easeArms(g, at(6, 8.5), 3);
  assert.equal(g.gates[1].open, 0, 'shuts when you walk away');
});
