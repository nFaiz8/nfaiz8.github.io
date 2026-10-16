import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { createWalker, stepWalker, RADIUS } from '../src/rpg/move.js';
import { createGates, gatedMap, trackGates, bumped, buy, topUp, easeArms, hasTicket, PRICES, START, TOP_UP, money,
  turnRotors, rotorTurns, pushFrom, ARM_X, readerText, READER, tapped, refused, swipeAgain, AGAIN_FOR, REFUSED_FOR } from '../src/rpg/gates.js';
import { emergencyTile, ledLines } from '../src/rpg/turnstiles.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const GATE_C = 12; // the shipped map's turnstile column

// Walk with input for a while, as index.js does each frame.
function walk(g, w, input, seconds, dt = 1 / 60, onFrame = null) {
  const map = gatedMap(MAP, g, w);
  let bumps = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    stepWalker(w, dt, input, map);
    trackGates(g, w);
    turnRotors(g, w);
    if (bumped(g, w, input)) bumps++;
    onFrame?.();
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

test('an unlimited ride lasts the visit', () => {
  const g = createGates(MAP), w = at(10.5, 10.5);
  buy(g, 'unlimited');
  for (let i = 0; i < 3; i++) {
    walk(g, w, { x: 1, y: 0 }, 1);
    assert.ok(w.x > GATE_C + 1, `trip ${i}: through`);
    walk(g, w, { x: -1, y: 0 }, 1);
  }
  assert.equal(g.pass, 'unlimited');
  assert.equal(g.wallet, START - PRICES.unlimited);
  assert.deepEqual(buy(g, 'single'), { ok: true, already: true }, 'nothing more to buy');
  assert.equal(g.wallet, START - PRICES.unlimited);
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
  assert.deepEqual(buy(g, 'unlimited'), { ok: true });
  assert.equal(g.wallet, 250 + TOP_UP - PRICES.unlimited);
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

test('the rotor turns a third of a turn as you push through, driven by where you are', () => {
  const g = createGates(MAP), w = at(10.5, 8.5), k = g.gates[1];
  buy(g, 'single');
  const seen = [];
  walk(g, w, { x: 1, y: 0 }, 1.2, 1 / 60, () => seen.push(rotorTurns(k)));
  assert.ok(w.x > GATE_C + 1 + RADIUS, 'through');
  assert.equal(rotorTurns(k), 1, 'at rest a third of a turn on');
  assert.equal(k.turns, 1);
  assert.ok(seen.some((v) => v > 0.2 && v < 0.8), 'part-way while you push');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1] - 1e-9, 'only ever forward going in');
  // The other gates never moved.
  for (const o of g.gates) if (o !== k) assert.equal(rotorTurns(o), 0);
});

test('pushFrom: nothing until your front reaches the arm, then over SWEEP, clicking over at the end', () => {
  const k = createGates(MAP).gates[0];
  assert.equal(pushFrom(k, GATE_C - RADIUS, 1), 0, 'stopped at a shut gate, short of the arm');
  assert.equal(pushFrom(k, GATE_C + ARM_X - RADIUS, 1), 0);
  assert.ok(Math.abs(pushFrom(k, GATE_C + ARM_X - RADIUS + 0.35, 1) - 0.5) < 1e-9, 'half way');
  assert.equal(pushFrom(k, GATE_C + ARM_X - RADIUS + 0.62, 1), 1, 'clicks over');
  assert.equal(pushFrom(k, GATE_C + 3, 1), 1);
  assert.equal(pushFrom(k, GATE_C + ARM_X + RADIUS, -1), 0, 'going west: from its east side');
  assert.equal(pushFrom(k, GATE_C - 1, -1), 1);
});

test('locked, the rotor does not move; going back to the hall it turns the other way; backing out it springs back', () => {
  const g = createGates(MAP), w = at(10.5, 10.5), k = g.gates[2];
  walk(g, w, { x: 1, y: 0 }, 1);
  assert.equal(rotorTurns(k), 0, 'you stop against the level arm');
  const p = at(13.7, 10.5);
  walk(g, p, { x: -1, y: 0 }, 1.2);
  assert.ok(p.x < GATE_C - RADIUS);
  assert.equal(rotorTurns(k), -1, 'a third of a turn back');
  buy(g, 'single');
  const b = at(11.6, 10.5);
  walk(g, b, { x: 1, y: 0 }, 0.13); // part way
  assert.ok(k.push > 0 && k.push < 1, `pushed part way: ${k.push}`);
  walk(g, b, { x: -1, y: 0 }, 0.6);
  assert.equal(rotorTurns(k), -1, 'back where it was');
  assert.equal(g.pass, 'single', 'and you kept your ticket');
});

test('the reader: idle alternates TAP HERE and SWIPE CARD; INSUFFICIENT FARE; GO; JUST USED', () => {
  const g = createGates(MAP, 3), far = at(5, 8.5);
  assert.deepEqual(g.gates.map((_, i) => readerText(g, i, far, 0)), [READER.tap, READER.swipe, READER.tap, READER.swipe]);
  const w = at(11.7, 8.5), k = g.gates[1];
  refused(g, k, 10);
  assert.equal(readerText(g, 1, w, 10.1), 'INSUFFICIENT FARE');
  assert.equal(readerText(g, 0, w, 10.1), READER.tap, 'only on its own gate');
  assert.equal(readerText(g, 1, w, 10 + REFUSED_FOR + 0.01), READER.swipe, 'and only for a while');
  buy(g, 'single');
  g.seed = 3; g.taps = 0; // seed 3's first tap is a plain one
  assert.equal(tapped(g, k, 20), false);
  assert.equal(readerText(g, 1, w, 20), 'GO');
  assert.equal(readerText(g, 0, w, 20), READER.tap, 'GO only at the gate you are at');
  walk(g, w, { x: 1, y: 0 }, 1);
  assert.equal(g.used, 1);
  assert.equal(readerText(g, 1, w, 30), READER.swipe, 'idle once you are through');
  walk(g, w, { x: -1, y: 0 }, 1);
  refused(g, k, 40);
  assert.equal(readerText(g, 1, w, 40.5), 'JUST USED');
});

test('swipe again: about one tap in four, the same for the same seed, and GO after a second', () => {
  let hits = 0;
  for (let n = 0; n < 4000; n++) hits += swipeAgain(12345, n) ? 1 : 0;
  assert.ok(hits > 850 && hits < 1150, `${hits} of 4000`);
  for (let n = 0; n < 50; n++) assert.equal(swipeAgain(99, n), swipeAgain(99, n));
  const seed = [...Array(100).keys()].find((s) => swipeAgain(s, 0));
  const g = createGates(MAP, seed), w = at(11.7, 8.5), k = g.gates[1];
  buy(g, 'single');
  assert.equal(tapped(g, k, 5), true);
  assert.equal(readerText(g, 1, w, 5.2), 'SWIPE AGAIN AT THIS TURNSTILE');
  assert.equal(readerText(g, 1, w, 5 + AGAIN_FOR + 0.01), 'GO');
  assert.equal(g.taps, 1, 'the next tap is the next number');
});

test('the line has an emergency gate spot at its north end, and the LED text fits its display', () => {
  assert.deepEqual(emergencyTile(MAP), { c: GATE_C, r: 5 });
  assert.deepEqual(ledLines('GO'), ['GO']);
  assert.deepEqual(ledLines('SWIPE AGAIN AT THIS TURNSTILE'), ['SWIPE AGAIN AT', 'THIS TURNSTILE']);
  assert.deepEqual(ledLines('INSUFFICIENT FARE'), ['INSUFFICIENT', 'FARE']);
});
