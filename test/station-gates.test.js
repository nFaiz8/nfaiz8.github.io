import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseStation } from '../src/rpg/map.js';
import { createWalker, stepWalker, RADIUS } from '../src/rpg/move.js';
import { createGates, gatedMap, trackGates, bumped, buy, topUp, easeArms, hasTicket, PRICES, START, TOP_UP, money,
  turnRotors, rotorTurns, pushFrom, ARM_X, refused, REFUSED_FOR, ringState, gateKinds, blocked, swingGates, swingFrom, alarmOn,
  ALARM_FOR, HINGE_X } from '../src/rpg/gates.js';

const MAP = parseStation(fs.readFileSync(new URL('../src/rpg/station.txt', import.meta.url), 'utf8'));
const GATE_C = 12; // the shipped map's turnstile column

// Walk with input for a while, as index.js does each frame.
let clock = 0; // the station's time, carried across walks
function walk(g, w, input, seconds, dt = 1 / 60, onFrame = null) {
  const map = gatedMap(MAP, g, w);
  let bumps = 0;
  for (let t = 0; t < seconds - 1e-9; t += dt) {
    clock += dt;
    stepWalker(w, dt, input, map);
    trackGates(g, w, clock);
    turnRotors(g, w);
    swingGates(g, w, dt);
    if (bumped(g, w, input)) bumps++;
    onFrame?.();
  }
  return bumps;
}
const at = (x, z) => ({ ...createWalker(MAP), x, z, y: 0 });

test('the shipped map has four gates in one column, the northernmost the emergency exit', () => {
  const g = createGates(MAP);
  assert.deepEqual(g.gates.map((k) => [k.c, k.r]), [[12, 6], [12, 8], [12, 10], [12, 12]]);
  assert.deepEqual(g.gates.map((k) => k.kind), ['emergency', 'turnstile', 'turnstile', 'turnstile']);
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
  const g = createGates(MAP), w = at(13.6, 12.5);
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
  assert.equal(g.gates[2].open, 0, 'not the gate in another row');
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
  const k = createGates(MAP).gates[1];
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
  const b = at(12, 10.5);
  walk(g, b, { x: 1, y: 0 }, 0.13); // part way
  assert.ok(k.push > 0 && k.push < 1, `pushed part way: ${k.push}`);
  walk(g, b, { x: -1, y: 0 }, 0.6);
  assert.equal(rotorTurns(k), -1, 'back where it was');
  assert.equal(g.pass, 'single', 'and you kept your ticket');
});

test('the tap target: idle, red a moment when you walk into it locked, green at your gate once you hold a ticket', () => {
  const g = createGates(MAP), far = at(5, 8.5);
  assert.deepEqual(g.gates.map((_, i) => ringState(g, i, far, 0)), [null, 'idle', 'idle', 'idle'], 'the emergency gate has none');
  const w = at(11.7, 8.5), k = g.gates[1];
  refused(g, k, 10);
  assert.equal(ringState(g, 1, w, 10.1), 'refused');
  assert.equal(ringState(g, 2, w, 10.1), 'idle', 'only on its own gate');
  assert.equal(ringState(g, 1, w, 10 + REFUSED_FOR + 0.01), 'idle', 'and only for a while');
  buy(g, 'single');
  assert.equal(ringState(g, 1, w, 20), 'go');
  assert.equal(ringState(g, 2, w, 20), 'idle', 'green only at the gate you are at');
  walk(g, w, { x: 1, y: 0 }, 1);
  assert.equal(ringState(g, 1, w, 30), 'idle', 'idle once you are through');
});

// The kinds come from the map: the northernmost gate of a column with more than one.
const mini = (rows) => parseStation(['name: T', ...rows].join('\n'));
test('gateKinds: the northernmost gate of each column of two or more is the emergency exit; a lone gate is a turnstile', () => {
  assert.deepEqual(gateKinds(MAP), ['emergency', 'turnstile', 'turnstile', 'turnstile']);
  const m = mini([
    '#########',
    '#S..:...#',
    '#...t.:.#',
    '#...:.t.#',
    '#.....:E#',
    '#########',
  ]);
  const kinds = m.cells.filter((c) => c.ch === ':').map((c) => [c.c, c.r]);
  assert.deepEqual(kinds, [[4, 1], [6, 2], [4, 3], [6, 4]]);
  assert.deepEqual(gateKinds(m), ['emergency', 'emergency', 'turnstile', 'turnstile']);
  const lone = mini(['#######', '#S.:.E#', '#######']);
  assert.deepEqual(gateKinds(lone), ['turnstile']);
});

const EXIT_Z = 6.5, exitGate = (g) => g.gates[0];
test('the emergency gate is locked from the hall, ticket or not, and walking into it does not open the fare machine', () => {
  for (const pass of [null, 'single', 'unlimited']) {
    const g = createGates(MAP), w = at(10.5, EXIT_Z);
    if (pass) buy(g, pass);
    let bumps = 0, blocks = 0;
    const map = gatedMap(MAP, g, w), input = { x: 1, y: 0 };
    for (let i = 0; i < 90; i++) {
      stepWalker(w, 1 / 60, input, map);
      trackGates(g, w, i / 60);
      swingGates(g, w, 1 / 60);
      if (bumped(g, w, input)) bumps++;
      if (blocked(g, w, input)) blocks++;
    }
    assert.ok(w.x + RADIUS <= GATE_C + 1e-6, `${pass}: stopped against it, x ${w.x}`);
    assert.equal(bumps, 0, `${pass}: no fare machine`);
    assert.ok(blocks > 0, `${pass}: it is blocked`);
    assert.equal(exitGate(g).swing, 0, `${pass}: it does not move`);
    assert.equal(g.pass, pass, `${pass}: and costs nothing`);
    assert.equal(alarmOn(g, exitGate(g), 1), false, 'no alarm');
  }
});

test('from the platform the emergency gate pushes open as you go, lets you out free, sounds the alarm, then swings shut', () => {
  clock = 100;
  const g = createGates(MAP), w = at(13.6, EXIT_Z), k = exitGate(g);
  const seen = [];
  walk(g, w, { x: -1, y: 0 }, 1.2, 1 / 60, () => seen.push(k.swing));
  assert.ok(w.x < GATE_C - RADIUS, `out in the hall: ${w.x}`);
  assert.equal(g.pass, null);
  assert.equal(g.used, 0, 'free');
  assert.ok(seen.some((v) => v > 0.2 && v < 0.8), 'part open while you push');
  assert.ok(seen.includes(1), 'right open as you pass');
  assert.ok(g.alarm && g.alarm.gate === k, 'the alarm went');
  assert.ok(alarmOn(g, k, g.alarm.from + 0.1) && alarmOn(g, k, g.alarm.from + ALARM_FOR - 0.1));
  assert.equal(alarmOn(g, k, g.alarm.from + ALARM_FOR + 0.01), false, 'for ALARM_FOR');
  walk(g, w, { x: -1, y: 0 }, 0.5);
  walk(g, w, { x: 0, y: 0 }, 2.5);
  assert.equal(k.swing, 0, 'shut again');
  // And it's locked again from the hall.
  const h = at(10.5, EXIT_Z);
  walk(g, h, { x: 1, y: 0 }, 1);
  assert.ok(h.x + RADIUS <= GATE_C + 1e-6);
});

test('swingFrom: nothing until your front reaches the panel, then more the further you go, clicking open at the end', () => {
  const k = exitGate(createGates(MAP)), hx = GATE_C + HINGE_X;
  assert.equal(swingFrom(k, hx + RADIUS, EXIT_Z), 0);
  assert.equal(swingFrom(k, hx + RADIUS + 0.5, EXIT_Z), 0);
  const a = swingFrom(k, hx + RADIUS - 0.1, EXIT_Z), b = swingFrom(k, hx + RADIUS - 0.3, EXIT_Z);
  assert.ok(a > 0 && a < b && b < 1, `${a} < ${b}`);
  // The hinge is on the north wall: the same push nearer it (further north) opens the gate further.
  const n = swingFrom(k, hx + RADIUS - 0.1, EXIT_Z - 0.15), s = swingFrom(k, hx + RADIUS - 0.1, EXIT_Z + 0.15);
  assert.ok(n > s && s > 0, `north ${n} > south ${s}`);
  assert.equal(swingFrom(k, hx - 1, EXIT_Z), 1);
});

test('backing out of the emergency gate into the platform: no alarm, and it shuts', () => {
  const g = createGates(MAP), w = at(13.6, EXIT_Z), k = exitGate(g);
  walk(g, w, { x: -1, y: 0 }, 0.45);
  assert.ok(k.swing > 0, 'pushed part way');
  walk(g, w, { x: 1, y: 0 }, 1);
  walk(g, w, { x: 0, y: 0 }, 2);
  assert.equal(g.alarm, null);
  assert.equal(k.swing, 0);
});

test('a single is not used up going out by the emergency gate', () => {
  const g = createGates(MAP), w = at(13.6, EXIT_Z);
  buy(g, 'single');
  walk(g, w, { x: -1, y: 0 }, 1.2);
  assert.equal(g.pass, 'single');
  assert.equal(g.used, 0);
});
