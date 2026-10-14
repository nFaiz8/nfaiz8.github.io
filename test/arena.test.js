import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, AIR, PLATFORM, SOLID } from '../src/arena.js';
import { levelKind } from '../src/level.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');

test('the level file is 33 lines of 204 characters, using only space, ═, ▓ and the S, R, N, D markers', () => {
  const lines = text.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 33);
  lines.forEach((l, i) => {
    assert.equal([...l].length, 204, `line ${i + 1}`);
    assert.match(l, /^[ ═▓SRND]*$/, `line ${i + 1}`);
  });
  assert.equal((text.match(/D/g) || []).length, 1, 'one door');
});

test('the door\'s 3 rows and the 4 columns west of it are clear, with the floor under them', () => {
  const L = parseLevel(text);
  const d = L.door;
  for (let r = d.r - 2; r <= d.r; r++) for (let c = d.c - 3; c <= d.c; c++) assert.equal(L.cells[r * L.cols + c], AIR, `${c},${r}`);
  for (let c = d.c - 3; c <= d.c; c++) assert.equal(L.cells[(d.r + 1) * L.cols + c], SOLID, `floor ${c}`);
});

// Every surface you can stand on: [row, first col, last col], top row of a run of non-air with air above.
function surfaces(L) {
  const at = (c, r) => (r < 0 ? SOLID : L.cells[r * L.cols + c]);
  const out = [];
  for (let r = 0; r < L.rows; r++) {
    let s = -1;
    for (let c = 0; c <= L.cols; c++) {
      const top = c < L.cols && at(c, r) !== AIR && at(c, r - 1) === AIR;
      if (top && s < 0) s = c;
      if (!top && s >= 0) { out.push({ row: r, x0: s, x1: c - 1 }); s = -1; }
    }
  }
  return out;
}

test('every ledge and both roofs can be reached from the floor: single jumps, at most one double jump a step (Task 18\'s constants)', () => {
  const L = parseLevel(text);
  const at = (c, r) => (r < 0 ? SOLID : L.cells[r * L.cols + c]);
  const single = JUMP_V ** 2 / (2 * GRAVITY), double = single + AIR_JUMPS * DOUBLE_V ** 2 / (2 * GRAVITY);
  assert.ok(single > 5.9 && double > 10, `the jumps: ${single.toFixed(2)} and ${double.toFixed(2)} rows`);
  const S = surfaces(L);
  const floor = S.findIndex((s) => s.row === L.door.r + 1 && s.x0 === 0 && s.x1 === L.cols - 1);
  assert.ok(floor >= 0, 'the floor is one surface, wall to wall');
  // A spot on a reaches b if b is at most a jump (with its air jump) higher, within a run's reach sideways, and
  // the column it rises through is clear of ▓ from a up to b's headroom.
  const REACH = 12;
  const clear = (a, b) => {
    for (let c = Math.max(a.x0, b.x0 - REACH); c <= Math.min(a.x1, b.x1 + REACH); c++) {
      let ok = true;
      for (let r = Math.min(a.row, b.row) - 3; r < a.row && ok; r++) ok = at(c, r) !== SOLID;
      if (ok) return true;
    }
    return false;
  };
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const seen = new Map([[floor, 'floor']]), queue = [floor];
  while (queue.length) {
    const i = queue.shift(), a = S[i];
    S.forEach((b, j) => {
      const rise = a.row - b.row;
      if (seen.has(j) || rise > double - 0.25 || gap(a, b) > REACH || !clear(a, b)) return;
      seen.set(j, rise > single - 0.25 ? 'double' : 'single');
      queue.push(j);
    });
  }
  const lost = S.filter((_, j) => !seen.has(j)).map((s) => `row ${s.row} cols ${s.x0}-${s.x1}`);
  assert.deepEqual(lost, []);
  const roofs = S.filter((s) => s.row === 8);
  assert.deepEqual(roofs.map((s) => [s.x0, s.x1]), [[2, 97], [104, 199]], 'both roofs are surfaces');
});

test('a scripted climb with the real physics: up the ledges in each gap, then sideways onto a roof', () => {
  const L = parseLevel(text);
  const kinds = levelKind(L);
  const IDLE = { x: 0, run: false, jump: false, down: false };
  const settle = (b) => { for (let i = 0; i < 90; i++) stepBody(b, 1 / 60, IDLE, kinds); };
  const hop = (b, x = 0) => {
    for (let i = 0; i < 21; i++) stepBody(b, 1 / 60, { ...IDLE, x, jump: true }, kinds);
    for (let i = 0; i < 90; i++) stepBody(b, 1 / 60, { ...IDLE, x }, kinds);
  };
  for (const [x0, side, roof] of [[100.5, -1, [2, 98]], [101.5, 1, [104, 200]], [0.9, 1, [2, 98]], [202.5, -1, [104, 200]]]) {
    const b = newBody(x0, L.door.y);
    settle(b);
    assert.equal(b.y, L.door.y, 'on the floor');
    for (const row of [21, 16, 11]) {
      hop(b);
      assert.equal(b.y, row - 1.5, `from x ${x0}: on the row-${row} ledge`);
    }
    hop(b, side);
    assert.equal(b.y, 8 - 1.5, `from x ${x0}: on a roof (${b.x.toFixed(2)}, ${b.y})`);
    assert.ok(b.x > roof[0] && b.x < roof[1], `on the roof of cols ${roof[0]}–${roof[1] - 1} (${b.x.toFixed(2)})`);
  }
});

test('headroom: the 3 cells above every standing spot are air (no ▓ and no ═); no standing spot in rows 0–2', () => {
  const L = parseLevel(text);
  const at = (c, r) => L.cells[r * L.cols + c];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    if (r === 0 || at(c, r) === AIR || at(c, r - 1) !== AIR) continue; // only tops of surfaces
    assert.ok(r >= 3, `standing spot at row ${r - 1}, col ${c}`);
    for (let k = 1; k <= 3; k++) assert.equal(at(c, r - k), AIR, `headroom at ${c},${r - k}`);
  }
});

test('the gap under any ▓ is 0 or at least 3 rows; the cars\' insides and doorways clear a standing body', () => {
  const L = parseLevel(text);
  const at = (c, r) => (r >= L.rows ? SOLID : L.cells[r * L.cols + c]);
  for (let c = 0; c < L.cols; c++) for (let r = 0; r < L.rows; r++) {
    if (at(c, r) !== SOLID || at(c, r + 1) === SOLID) continue;
    let gap = 0;
    while (r + 1 + gap < L.rows && at(c, r + 1 + gap) === AIR) gap++;
    if (r + 1 + gap >= L.rows) continue; // over the undercarriage: nobody gets down there
    assert.ok(gap === 0 || gap >= 3, `a ${gap}-row slot under ▓ at ${c},${r}`);
  }
});

test('parseLevel: ═ is a platform, ▓ is solid, anything else is air, and short input is padded', () => {
  const L = parseLevel('═▓x\n');
  assert.equal(L.cols, 204);
  assert.equal(L.rows, 33);
  assert.deepEqual([...L.cells.slice(0, 4)], [PLATFORM, SOLID, AIR, AIR]);
  assert.equal(L.cells[32 * 204 + 203], AIR);
});

import { newBody, stepBody, sideCamera, knock, startRoll, BODY, ROLL, RUN, SPRINT, JUMP_V, GRAVITY, DOUBLE_V, AIR_JUMPS } from '../src/arena.js';

// A small test room, 40 × 20: floor below row 19, walls left and right, a platform at row 15 (cols 10–19, 5 rows up),
// a solid block at rows 16–19 (cols 30–33) and a low ▓ ceiling at row 15 (cols 0–5).
const kindAt = (c, r) => {
  if (c < 0 || c >= 40 || r >= 20) return SOLID;
  if (r < 0) return AIR;
  if (r === 15 && c >= 10 && c <= 19) return PLATFORM;
  if (r >= 16 && c >= 30 && c <= 33) return SOLID;
  if (r === 15 && c <= 5) return SOLID;
  return AIR;
};
const IDLE = { x: 0, run: false, jump: false, down: false };
const sim = (b, seconds, input = IDLE, dt = 1 / 60, each = () => {}) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) { stepBody(b, dt, typeof input === 'function' ? input(t) : input, kindAt); each(b, t); }
};

test('falling lands on the floor', () => {
  const b = newBody(7.5, 3.5);
  sim(b, 2);
  assert.equal(b.y, 18.5);
  assert.equal(b.onGround, true);
});

test('a full jump rises about 6 rows and is about 0.6 s in the air', () => {
  const b = newBody(7.5, 18.5);
  sim(b, 0.2);
  let top = b.y, air = 0;
  sim(b, 1.2, { ...IDLE, jump: true }, 1 / 60, (s) => { top = Math.min(top, s.y); if (!s.onGround) air += 1 / 60; });
  assert.ok(Math.abs(18.5 - top - 6) <= 0.5, `rose ${18.5 - top}`);
  assert.ok(Math.abs(air - 0.6) <= 0.06, `air ${air}`);
});

test('letting go of jump early makes a short hop', () => {
  const b = newBody(7.5, 18.5);
  sim(b, 0.2);
  let top = b.y;
  sim(b, 1, (t) => ({ ...IDLE, jump: t < 0.03 }), 1 / 60, (s) => { top = Math.min(top, s.y); });
  assert.ok(18.5 - top < 4, `rose ${18.5 - top}`);
});

test('you jump up through ═, stand on it, and ↓ drops you back through', () => {
  const b = newBody(14.5, 18.5);
  sim(b, 0.2);
  sim(b, 1.5, (t) => ({ ...IDLE, jump: t < 0.5 }));
  assert.equal(b.y, 13.5, 'standing on the platform');
  assert.equal(b.onPlatform, true);
  sim(b, 0.05, { ...IDLE, down: true });
  sim(b, 1);
  assert.equal(b.y, 18.5, 'back on the floor');
});

test('▓ blocks from the side, from above and from below; ↓ on ▓ does nothing', () => {
  const b = newBody(25.5, 18.5);
  sim(b, 2, { ...IDLE, x: 1, run: true });
  assert.ok(b.x <= 30 - 0.4 + 1e-9 && b.x > 29, `stopped at the block (${b.x})`);
  const top = newBody(31.5, 5.5);
  sim(top, 2);
  assert.equal(top.y, 14.5, 'lands on top');
  sim(top, 0.5, { ...IDLE, down: true });
  assert.equal(top.y, 14.5, 'no dropping through ▓');
  const under = newBody(3.5, 18.5);
  sim(under, 0.2);
  let high = under.y;
  sim(under, 1, { ...IDLE, jump: true }, 1 / 60, (s) => { high = Math.min(high, s.y); });
  assert.equal(high, 17.5, 'head stops under the ceiling');
});

test('nothing tunnels at 20 fps', () => {
  const b = newBody(14.5, 0.5);
  sim(b, 3, IDLE, 1 / 20);
  assert.equal(b.y, 13.5, 'a long fall still lands on a one-row platform');
  const r = newBody(20.5, 18.5);
  sim(r, 3, { ...IDLE, x: 1, run: true }, 1 / 20);
  assert.ok(r.x < 30, 'sprinting at 20 fps still stops at the block');
});

test('coyote time: a jump just after running off a ledge is the ground jump; a late one is the air jump', () => {
  const offEdge = (lateFrames) => {
    const b = newBody(17.5, 13.5);
    sim(b, 0.1);
    let left = -1, frame = 0, landed = false, vy = 0;
    sim(b, 1, () => ({ ...IDLE, x: 1, jump: left >= 0 && frame - left >= lateFrames }), 1 / 60, (s) => {
      frame++;
      if (left < 0 && !s.onGround) left = frame;
      if (left >= 0 && s.onGround) landed = true; // a press held into the landing is the jump buffer's, not coyote time's
      if (!landed) vy = Math.min(vy, s.vy);
    });
    return vy;
  };
  assert.ok(offEdge(3) < -JUMP_V + 3, `0.05 s late: the ground jump (${offEdge(3)})`);
  const late = offEdge(10);
  assert.ok(late > -DOUBLE_V && late < -DOUBLE_V + 3, `0.17 s late: the air jump (${late})`);
});

test('jump buffer, the air jump spent: pressing just before landing jumps on landing; too early does nothing', () => {
  const land = () => { const b = newBody(7.5, 8.5); let f = 0; while (!b.onGround) { stepBody(b, 1 / 60, IDLE, kindAt); f++; } return f; };
  const L = land();
  const pressAt = (early) => {
    const b = newBody(7.5, 8.5);
    b.airJumps = 0; // spent: a press in the air can only be buffered
    let f = 0, top = 99;
    sim(b, 1.5, () => ({ ...IDLE, jump: f >= L - early && f < L + 1 }), 1 / 60, (s) => { f++; if (f > L) top = Math.min(top, s.y); });
    return 18.5 - top;
  };
  assert.ok(pressAt(4) > 1, 'buffered jump fired');
  assert.ok(pressAt(12) < 0.01, 'a press 0.2 s early is forgotten');
});

test('a held jump never fires again by itself, and entering with jump held does not jump', () => {
  const b = newBody(7.5, 18.5);
  b.prevJump = true; // as on arrival through the door with W held
  let top = 18.5;
  sim(b, 1, { ...IDLE, jump: true }, 1 / 60, (s) => { top = Math.min(top, s.y); });
  assert.equal(top, 18.5);
});

test('the body is 0.8 cells by 3 rows', () => assert.deepEqual(BODY, { w: 0.8, h: 3 }));

// The test room with a 3-row door in its east wall (col 40, rows 17–19) into a corridor to col 50.
const doorKind = (c, r) => {
  if (r >= 20 || c < 0 || c > 50 || r < 0) return SOLID;
  if (c >= 40) return r >= 17 ? AIR : SOLID;
  return AIR;
};
const inside = (c) => c < 40;
const simIn = (b, seconds, input, kinds = doorKind, opts = { inside }, dt = 1 / 60) => {
  for (let t = 0; t < seconds - 1e-9; t += dt) stepBody(b, dt, typeof input === 'function' ? input(t) : input, kinds, opts);
};

test('the 3-row body walks through a 3-row door both ways', () => {
  const b = newBody(35.5, 18.5);
  simIn(b, 0.2, IDLE);
  simIn(b, 1, { ...IDLE, x: 1 });
  assert.ok(b.x > 45, `east through the door (${b.x})`);
  simIn(b, 1, { ...IDLE, x: -1 });
  assert.ok(b.x < 38, `back west (${b.x})`);
});

test('knock: sets the velocity, leaves the ground when ky is upward, and stuns; input is ignored and speed decays with a 0.35 s time constant', () => {
  const b = newBody(10.5, 18.5);
  sim(b, 0.2);
  knock(b, 20, -22, 0.4);
  assert.equal(b.onGround, false);
  stepBody(b, 1 / 60, { ...IDLE, x: -1, jump: true }, kindAt);
  assert.ok(Math.abs(b.vx - 20 * Math.exp(-1 / 60 / 0.35)) < 1e-9, `vx ${b.vx}`);
  for (let i = 1; i < 21; i++) stepBody(b, 1 / 60, { ...IDLE, x: -1 }, kindAt);
  assert.ok(Math.abs(b.vx - 20 * Math.exp(-21 / 60 / 0.35)) < 1e-6, 'still decaying after 0.35 s');
  const r = newBody(10.5, 18.5);
  sim(r, 0.2);
  knock(r, 20, 0, 0.2);
  stepBody(r, 1 / 60, IDLE, kindAt, { reducedMotion: true });
  assert.ok(Math.abs(r.vx - 20 * Math.exp(-1 / 60 / 0.35)) < 1e-9, 'Reduce Motion does not change the decay');
});

test('a bullet-style knock (add) keeps a jump going, adds to vy, and the jump can still be cut', () => {
  const J = { ...IDLE, jump: true };
  const b = newBody(10.5, 18.5);
  sim(b, 0.2);
  sim(b, 0.1, J);
  const vy = b.vy;
  knock(b, 10, 0, 0.1, true);
  assert.equal(b.vy, vy);
  const c = newBody(10.5, 18.5);
  sim(c, 0.2);
  sim(c, 0.1, J);
  const vc = c.vy;
  knock(c, 10, -5, 0.1, true);
  assert.equal(c.vy, vc - 5, 'adds');
  // Stun over, jump released while still rising: the cut still applies after a sideways bullet.
  const d = newBody(10.5, 18.5);
  sim(d, 0.2);
  sim(d, 0.05, J);
  knock(d, 10, 0, 0.02, true);
  sim(d, 0.05, J);
  const rising = d.vy;
  assert.ok(rising < -10 && d.cut === false, 'still rising, cut available');
  stepBody(d, 1 / 60, IDLE, kindAt);
  assert.ok(d.vy > rising / 2 - 3, `cut (${d.vy} from ${rising})`);
  const g = newBody(10.5, 18.5);
  sim(g, 0.2);
  knock(g, 0, -5, 0.1, true);
  assert.equal(g.onGround, false, 'an upward bullet knock lifts a grounded body');
});

test('a strike knock mid-jump with jump held replaces vy and is not halved; a short stun ending with the key released is not halved either', () => {
  const J = { ...IDLE, jump: true };
  const up = newBody(10.5, 18.5);
  sim(up, 0.2);
  sim(up, 0.05, J);
  knock(up, 20, -22, 0.4);
  assert.equal(up.vy, -22);
  stepBody(up, 1 / 60, J, kindAt);
  assert.ok(Math.abs(up.vy - (-22 + 133 / 60)) < 1e-9, `vy1 ${up.vy}`);
  const s = newBody(10.5, 18.5);
  sim(s, 0.2);
  sim(s, 0.05, J);
  knock(s, 20, -22, 0.03);
  sim(s, 0.03, J);
  stepBody(s, 1 / 60, IDLE, kindAt); // stun over, key released while still rising
  assert.ok(s.vy < -14, `knock vy not halved (${s.vy})`);
});

test('a roll that ends in the air eases its speed back with air control', () => {
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  stepBody(b, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  sim(b, 0.1);
  stepBody(b, 1 / 60, { ...IDLE, jump: true }, kindAt);
  sim(b, 0.1, { ...IDLE, jump: true });
  assert.ok(b.vx < 48 && b.vx > 0, `eased (${b.vx})`);
});

test('the door blocks a stunned body but not a walking one', () => {
  const b = newBody(35.5, 18.5);
  simIn(b, 0.2, IDLE);
  knock(b, 45, 0, 0.4);
  simIn(b, 0.4, IDLE);
  assert.ok(b.x <= 40 - 0.4 + 1e-9, `stopped at the door (${b.x})`);
});

test('a roll covers 14 ± 1 cells in 0.30 s the way it was asked, ignoring steering, then ends', () => {
  for (const dt of [1 / 20, 1 / 60, 1 / 144]) {
    const b = newBody(5.5, 18.5);
    sim(b, 0.2, IDLE, dt);
    const x0 = b.x;
    stepBody(b, dt, { ...IDLE, roll: 1 }, kindAt);
    sim(b, 0.3 - dt, { ...IDLE, x: -1 }, dt);
    assert.ok(Math.abs(b.x - x0 - 14.4) <= 1, `moved ${b.x - x0} at ${Math.round(1 / dt)} fps`);
    sim(b, 2 * dt, { ...IDLE, x: -1 }, dt);
    assert.equal(b.rollT, -1);
  }
});

test('no roll in the air, while stunned, or within 0.5 s of the last', () => {
  const air = newBody(5.5, 10.5);
  assert.equal(startRoll(air, 1), false);
  const st = newBody(5.5, 18.5);
  sim(st, 0.2);
  knock(st, 0, 0, 0.2);
  assert.equal(startRoll(st, 1), false);
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  assert.equal(startRoll(b, 1), true);
  sim(b, 0.35);
  assert.equal(startRoll(b, -1), false, 'cooling down');
  sim(b, 0.5);
  assert.equal(startRoll(b, -1), true);
});

test('a jump during a roll ends it and keeps its speed (a long jump)', () => {
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  stepBody(b, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  sim(b, 0.1);
  stepBody(b, 1 / 60, { ...IDLE, jump: true }, kindAt);
  assert.equal(b.rollT, -1);
  assert.equal(b.onGround, false);
  assert.equal(b.vx, 48, 'kept its full speed at take-off');
  const rm = newBody(5.5, 18.5);
  sim(rm, 0.2);
  stepBody(rm, 1 / 60, { ...IDLE, roll: 1 }, kindAt, { reducedMotion: true });
  sim(rm, 0.1);
  stepBody(rm, 1 / 60, { ...IDLE, jump: true }, kindAt, { reducedMotion: true });
  assert.equal(rm.vx, 48, 'and with Reduce Motion');
});

test('a roll off a ledge ends and falls, keeping its speed', () => {
  const b = newBody(17.5, 13.5); // on the platform at row 15, cols 10–19
  sim(b, 0.2);
  stepBody(b, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  let n = 0;
  while (b.onGround && n++ < 60) stepBody(b, 1 / 60, IDLE, kindAt);
  assert.equal(b.rollT, -1);
  assert.equal(b.onGround, false);
  assert.equal(b.vx, 48, 'keeps the roll speed at the moment it leaves');
});

test('a roll covers 14.4 cells whatever the step sizes, even a coarse one or a clamped hitch', () => {
  const run = (dts) => {
    const b = newBody(5.5, 18.5);
    sim(b, 0.2);
    const x0 = b.x;
    stepBody(b, dts[0], { ...IDLE, roll: 1 }, kindAt);
    for (const dt of dts.slice(1)) { if (b.rollT < 0) break; stepBody(b, dt, IDLE, kindAt); }
    assert.equal(b.rollT, -1);
    return b.x - x0;
  };
  const fill = (first, dt) => { const a = [first]; let t = first; while (t < 0.5) { a.push(dt); t += dt; } return a; };
  assert.ok(Math.abs(run(fill(0.049, 0.049)) - 14.4) <= 0.2, 'dt 0.049');
  const mix = fill(1 / 60, 1 / 60); mix.splice(5, 0, 0.05);
  assert.ok(Math.abs(run(mix) - 14.4) <= 0.2, '1/60 with one 50 ms step');
});

test('stunned with jump held: the knock keeps its velocity, and no jump fires when the stun ends', () => {
  const up = newBody(10.5, 18.5);
  sim(up, 0.2);
  knock(up, 20, -22, 0.4);
  stepBody(up, 1 / 60, { ...IDLE, jump: true }, kindAt);
  assert.ok(up.vy < -22 + 133 / 60 + 0.01 && up.vy > -22, `vy only gravity-changed (${up.vy})`);
  stepBody(up, 1 / 60, { ...IDLE, jump: true }, kindAt);
  assert.ok(up.vy < -17, `still not halved (${up.vy})`);
  const g = newBody(10.5, 18.5);
  sim(g, 0.2);
  knock(g, 5, 0, 0.2);
  let top = g.y;
  sim(g, 1, { ...IDLE, jump: true }, 1 / 60, (s) => { top = Math.min(top, s.y); });
  assert.equal(top, 18.5, 'holding jump through a stun does not jump after it');
});

test('a knock ends a roll', () => {
  const b = newBody(5.5, 18.5);
  sim(b, 0.2);
  startRoll(b, 1);
  knock(b, -10, 0, 0.1);
  assert.equal(b.rollT, -1);
});

// The double jump (headshots and double jump addendum §2).
const J = { ...IDLE, jump: true };
// Stand (holding `held`), jump for `frames` steps, let go, and carry on until vy reaches `at` (rows/s, + down).
function airborne(at = 0, held = {}, frames = 1, x = 7.5) {
  const b = newBody(x, 18.5);
  sim(b, 0.2, { ...IDLE, ...held });
  for (let i = 0; i < frames; i++) stepBody(b, 1 / 60, { ...IDLE, ...held, jump: true }, kindAt);
  do stepBody(b, 1 / 60, { ...IDLE, ...held }, kindAt); while (b.vy < at && !b.onGround);
  assert.equal(b.onGround, false, 'still in the air');
  return b;
}

test('the double jump: AIR_JUMPS is 1 and DOUBLE_V 34; a fresh body has its air jump and none taken yet', () => {
  assert.equal(AIR_JUMPS, 1);
  assert.equal(DOUBLE_V, 34);
  const b = newBody(7.5, 18.5);
  assert.equal(b.airJumps, AIR_JUMPS);
  assert.equal(b.airJumpT, -Infinity);
});

test('one air jump after a ground jump, none more until landing; airJumpT is the body time it was taken', () => {
  const b = airborne();
  stepBody(b, 1 / 60, J, kindAt);
  assert.ok(Math.abs(b.vy - (-DOUBLE_V + GRAVITY / 60)) < 1e-9, `vy ${b.vy}`);
  assert.equal(b.airJumps, 0);
  assert.equal(b.airJumpT, b.t);
  const t = b.t;
  sim(b, 0.05);
  const vy = b.vy;
  stepBody(b, 1 / 60, J, kindAt); // a third press
  assert.ok(Math.abs(b.vy - (vy + GRAVITY / 60)) < 1e-9, 'no second air jump');
  assert.equal(b.airJumpT, t);
  sim(b, 2);
  assert.equal(b.onGround, true);
  assert.equal(b.airJumps, AIR_JUMPS, 'refilled on landing');
  stepBody(b, 1 / 60, IDLE, kindAt);
  stepBody(b, 1 / 60, J, kindAt);
  assert.ok(b.vy < -JUMP_V + 3, 'the next press on the ground is a ground jump');
  assert.equal(b.airJumps, AIR_JUMPS, 'and leaves the air jump');
});

test('the air jump is about 4.3 rows more height, taken at the top of a full jump', () => {
  const peak = (double) => {
    const b = newBody(7.5, 18.5);
    sim(b, 0.2);
    let top = b.y;
    sim(b, 1.6, (t) => ({ ...IDLE, jump: t < 0.32 || (double && t >= 0.34 && t < 0.8) }), 1 / 60, (s) => { top = Math.min(top, s.y); });
    return 18.5 - top;
  };
  const one = peak(false), two = peak(true);
  assert.ok(Math.abs(two - one - 4.35) < 0.4, `${one.toFixed(2)} then ${two.toFixed(2)}`);
});

test('running off a ledge gives one air jump', () => {
  const b = newBody(17.5, 13.5); // on the platform at row 15, cols 10–19
  sim(b, 0.1);
  while (b.onGround) stepBody(b, 1 / 60, { ...IDLE, x: 1 }, kindAt);
  sim(b, 0.2, { ...IDLE, x: 1 }); // past coyote time
  assert.ok(b.vy > 0, 'falling');
  stepBody(b, 1 / 60, { ...IDLE, x: 1, jump: true }, kindAt);
  assert.ok(Math.abs(b.vy - (-DOUBLE_V + GRAVITY / 60)) < 1e-9, `vy ${b.vy}`);
  assert.equal(b.airJumps, 0);
  sim(b, 0.05, { ...IDLE, x: 1 });
  const vy = b.vy;
  stepBody(b, 1 / 60, { ...IDLE, x: 1, jump: true }, kindAt);
  assert.ok(Math.abs(b.vy - vy - GRAVITY / 60) < 1e-9, 'only one');
});

test('the air jump replaces any vy, even a fall, and resets the cut: letting go early still shortens it', () => {
  const b = airborne(20, {}, 3); // a short jump (already cut), now falling
  assert.equal(b.cut, true);
  stepBody(b, 1 / 60, J, kindAt);
  assert.ok(Math.abs(b.vy - (-DOUBLE_V + GRAVITY / 60)) < 1e-9, `arrested the fall (${b.vy})`);
  assert.equal(b.cut, false);
  const rising = b.vy;
  stepBody(b, 1 / 60, IDLE, kindAt);
  assert.ok(Math.abs(b.vy - (rising * 0.5 + GRAVITY / 60)) < 1e-9, `let go: cut (${b.vy})`);
  assert.equal(b.cut, true);
});

test('the air jump redirects: a held direction reverses or keeps the speed at once (sprint too); no direction keeps vx', () => {
  // Running right, then the air jump holding left: vx is −RUN at once.
  const run = { ...IDLE, x: 1 };
  const r = airborne(-5, run);
  assert.ok(r.vx > 20, `running right (${r.vx})`);
  stepBody(r, 1 / 60, { ...IDLE, x: -1, jump: true }, kindAt);
  assert.ok(Math.abs(r.vx + RUN) < 1e-9, `reversed (${r.vx})`);
  const s = airborne(-5, run);
  stepBody(s, 1 / 60, { ...IDLE, x: -1, run: true, jump: true }, kindAt);
  assert.ok(s.vx < -RUN * SPRINT + 1 && s.vx >= -RUN * SPRINT - 1e-9, `sprinting the other way (${s.vx})`);
  // Faster than a run (a sprint) the same way: kept, then steered as usual.
  const f = airborne(-5, { ...run, run: true });
  const twinF = airborne(-5, { ...run, run: true });
  stepBody(f, 1 / 60, { ...IDLE, x: 1, jump: true }, kindAt);
  stepBody(twinF, 1 / 60, { ...IDLE, x: 1 }, kindAt);
  assert.ok(Math.abs(f.vx - twinF.vx) < 1e-9, `kept (${f.vx} vs ${twinF.vx})`);
  // No direction: vx is whatever it would have been without the jump.
  const n = airborne(-5, run), twin = airborne(-5, run);
  stepBody(n, 1 / 60, J, kindAt);
  stepBody(twin, 1 / 60, IDLE, kindAt);
  assert.equal(n.vx, twin.vx);
  assert.ok(n.vy < -20 && twin.vy > -20, 'only one of them jumped');
});

test('a roll\'s long jump is airborne: its air jump is still there, and keeps the roll\'s speed', () => {
  const b = newBody(5.5, 18.5), twin = newBody(5.5, 18.5);
  for (const x of [b, twin]) {
    sim(x, 0.2);
    stepBody(x, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
    sim(x, 0.1);
    stepBody(x, 1 / 60, J, kindAt); // the long jump out of the roll
    assert.equal(x.airJumps, AIR_JUMPS);
    sim(x, 0.1);
  }
  stepBody(b, 1 / 60, J, kindAt);
  stepBody(twin, 1 / 60, IDLE, kindAt);
  assert.equal(b.airJumps, 0);
  assert.ok(b.vy < -30);
  assert.equal(b.vx, twin.vx);
});

test('no air jump while stunned; once the stun is over a fresh press takes it', () => {
  const b = airborne(-10, {}, 12);
  knock(b, 5, 0, 0.1, true);
  const vy = b.vy;
  stepBody(b, 1 / 60, J, kindAt);
  assert.ok(Math.abs(b.vy - vy - GRAVITY / 60) < 1e-9, 'stunned: no jump');
  assert.equal(b.airJumps, AIR_JUMPS);
  sim(b, 0.1, J); // held through the stun's end: not a fresh press
  assert.equal(b.airJumps, AIR_JUMPS);
  stepBody(b, 1 / 60, IDLE, kindAt);
  stepBody(b, 1 / 60, J, kindAt);
  assert.equal(b.airJumps, 0, 'a fresh press after it');
});

test('touching the ground refills the air jump: the floor, a platform top and a ▓ top', () => {
  const land = (x, y) => {
    const b = newBody(x, y);
    b.airJumps = 0;
    sim(b, 2);
    assert.equal(b.onGround, true);
    return b.airJumps;
  };
  assert.equal(land(7.5, 3.5), AIR_JUMPS, 'the floor');
  assert.equal(land(14.5, 3.5), AIR_JUMPS, 'a platform');
  assert.equal(land(31.5, 3.5), AIR_JUMPS, 'a ▓ top');
  // A rolling body is on the ground: its press is a ground jump.
  const r = newBody(5.5, 18.5);
  sim(r, 0.2);
  stepBody(r, 1 / 60, { ...IDLE, roll: 1 }, kindAt);
  stepBody(r, 1 / 60, J, kindAt);
  assert.ok(r.vy < -JUMP_V + 3);
  assert.equal(r.airJumps, AIR_JUMPS);
});

test('the side camera leads, clamps to the room, and keeps the floor in view', () => {
  const a = { x: 100, y: 10, w: 242, h: 52 };
  const view = { cols: 150, rows: 32 };
  const floor = { x: 200, y: a.y + a.h - 1.5 };
  const c = sideCamera(a, view, floor, 8);
  assert.equal(c.x, 208);
  assert.equal(c.y + view.rows / 2, a.y + a.h, 'floor wall is the bottom row');
  const left = sideCamera(a, view, { x: a.x + 2, y: floor.y });
  assert.equal(left.x - view.cols / 2, a.x, 'clamped at the west wall');
  const high = sideCamera(a, view, { x: 200, y: a.y + 3 });
  assert.equal(high.y - view.rows / 2, a.y, 'clamped at the ceiling');
  const tall = sideCamera(a, { cols: 150, rows: 60 }, floor);
  assert.equal(tall.y + 60 / 2, a.y + a.h, 'a tall view shows the whole room, its floor wall the bottom row');
});

import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { kindsFor } from '../src/arena.js';

test('kindsFor: level cells inside, walls solid, the door open', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const d = indexData(json, ['IMG_1003']);
  const map = buildLayout(d, { name: 'Faiz' }, { arena: { photo: d.byId.get('IMG_1003'), level: parseLevel(text) } });
  const a = map.arena, k = kindsFor(map), L = a.level;
  const i = L.cells.indexOf(PLATFORM);
  assert.equal(k(a.x + 1 + (i % L.cols), a.y + 1 + Math.floor(i / L.cols)), PLATFORM);
  assert.equal(k(a.x, a.y + 5), SOLID, 'west wall');
  assert.equal(k(a.x + 5, a.floorY), SOLID, 'floor');
  assert.equal(k(a.door.x, a.door.y + 1), AIR, 'door');
  assert.equal(k(a.door.x + 1, a.door.y + 1), AIR, 'corridor');
});


// The side view zooms in by gun (bigger-zoom addendum §2, with the train level's rows).
import { SIDE_ROWS, sideZoom, ZOOM_TIME } from '../src/arena.js';

test('SIDE_ROWS: deagle 20, rifle 25, sniper 33 (the whole height), no fight 24', () => {
  assert.deepEqual(SIDE_ROWS, { deagle: 20, rifle: 25, sniper: 33, none: 24 });
  assert.equal(ZOOM_TIME, 0.35);
});

test('sideZoom: starts settled on the gun\'s rows; no fight is 24; dead (undefined) keeps the last value', () => {
  const z = sideZoom(null, 'deagle', 10);
  assert.deepEqual([z.rows, z.settled], [20, true]);
  assert.equal(sideZoom(null, null, 10).rows, 24);
  const r = sideZoom(sideZoom(null, 'rifle', 0), undefined, 5);
  assert.deepEqual([r.rows, r.settled], [25, true]);
  const again = sideZoom(z, 'deagle', 11);
  assert.deepEqual([again.rows, again.settled], [20, true], 'the same gun: still settled');
});

test('sideZoom: changing guns eases over 0.35 s with 1 − (1 − k)³, then settles; a change mid-ease starts from where it is', () => {
  let z = sideZoom(null, 'deagle', 0);
  z = sideZoom(z, 'sniper', 1);
  assert.deepEqual([z.rows, z.settled], [20, false]);
  const half = sideZoom(z, 'sniper', 1 + 0.175);
  assert.ok(Math.abs(half.rows - (20 + 13 * (1 - 0.5 ** 3))) < 1e-9, `half way ${half.rows}`);
  assert.equal(half.settled, false);
  const done = sideZoom(half, 'sniper', 1.35);
  assert.deepEqual([done.rows, done.settled], [33, true]);
  // Back to the deagle half way through: from the rows at that moment, not from 33.
  const back = sideZoom(half, 'deagle', 1.175);
  assert.ok(Math.abs(back.rows - half.rows) < 1e-9 && back.to === 20);
  assert.equal(sideZoom(back, 'deagle', 1.175 + 0.35).rows, 20);
});

test('sideZoom: Reduce Motion switches at once', () => {
  let z = sideZoom(null, 'deagle', 0, { reducedMotion: true });
  z = sideZoom(z, 'sniper', 1, { reducedMotion: true });
  assert.deepEqual([z.rows, z.settled], [33, true]);
});

test('the side camera\'s lead scales with the view\'s width: half the cells, half the lead', () => {
  const a = { x: 100, y: 10, w: 242, h: 52 };
  const floor = { x: 200, y: a.y + a.h - 1.5 };
  assert.equal(sideCamera(a, { cols: 150, rows: 32 }, floor, 8).x, 208);
  assert.equal(sideCamera(a, { cols: 75, rows: 20 }, floor, 8).x, 204);
});

test('the train: on its floor the camera keeps the floor line near the bottom, 5 rows of floor and bogies under the feet, not the whole undercarriage', () => {
  const a = { x: 100, y: 10, w: 206, h: 35, floorY: 10 + 1 + 26 }; // floorY: the floor slab's top (map rows)
  const feet = { x: 200, y: a.floorY - 1.5 };
  for (const rows of [20, 25]) {
    const c = sideCamera(a, { cols: 90, rows }, feet);
    assert.equal(c.y + rows / 2, a.floorY + 5, `${rows} rows: the bottom row`);
  }
  // On the roof the camera follows up, and the whole room (the sniper's) is still centred.
  const roof = sideCamera(a, { cols: 90, rows: 20 }, { x: 200, y: a.y + 1 + 6.5 });
  assert.ok(roof.y - 10 <= a.y + 1, `the roof's top is in view (${roof.y})`);
  assert.equal(sideCamera(a, { cols: 150, rows: 35 }, feet).y, a.y + a.h / 2, 'exactly as tall: the whole room');
});

test('on touch the side camera keeps an inset: the figure off the screen\'s side; the feet above the pad only where a pad cluster is (the room\'s ends, the door)', () => {
  const a = { x: 100, y: 10, w: 206, h: 35 };
  const view = { cols: 64, rows: 20 };
  // The pad: a cluster 14 cells wide at the bottom left, 16 at the bottom right; its top 9 rows up.
  const inset = { bottom: 9, side: 5, left: 14, right: 16 };
  const plain = (p) => sideCamera(a, view, p);
  for (const p of [{ x: a.x + a.w - 1.5, y: a.y + 25.5 }, { x: a.x + 1.5, y: a.y + 25.5 }]) {
    const c = sideCamera(a, view, p, 0, inset), sx = p.x - (c.x - view.cols / 2);
    assert.ok(sx < inset.left || sx > view.cols - inset.right, `at an end the figure is over a cluster (${sx})`);
    assert.ok(c.y + view.rows / 2 >= p.y + 1.5 + inset.bottom - 1e-9, `feet ${inset.bottom} rows above the bottom (${c.y})`);
    assert.ok(sx >= inset.side - 1e-9 && view.cols - sx >= inset.side - 1e-9, `off the sides (${c.x})`);
  }
  // Mid-room the figure is between the clusters: nothing under it to clear, so the camera is as without touch.
  for (const lead of [0, 8, -8]) {
    const p = { x: a.x + 100, y: a.y + 25.5 }, c = sideCamera(a, view, p, lead, inset), sx = p.x - (c.x - view.cols / 2);
    assert.ok(sx >= inset.left && sx <= view.cols - inset.right, `between the clusters (${sx})`);
    assert.deepEqual(c, sideCamera(a, view, p, lead), `lead ${lead}: no bottom inset mid-room`);
  }
  // Without an inset, the room's edges clamp as before.
  const c = plain({ x: a.x + a.w - 1.5, y: a.y + 25.5 });
  assert.equal(c.x + view.cols / 2, a.x + a.w);
});

test('a view as tall as the room shows the whole room: row 0 at the top or below it, never pushed off by the touch inset', () => {
  const a = { x: 100, y: 10, w: 206, h: 35, cols: 204, rows: 33, floorY: 10 + 1 + 26 };
  const inset = { bottom: 13.8, side: 4, left: 16, right: 18 }; // an 852 × 393 phone with the sniper
  for (const rows of [33, 34.62, 35.7, 40]) {
    const view = { cols: 77, rows };
    for (const p of [{ x: a.x + a.w - 1.5, y: a.floorY - 1.5 }, { x: a.x + 1.5, y: a.floorY - 1.5 }, { x: a.x + 100, y: a.floorY - 1.5 }, { x: a.x + 40, y: a.y + 1 + 6.5 }]) {
      for (const ins of [null, inset]) {
        const c = sideCamera(a, view, p, 8, ins), top = c.y - rows / 2, bottom = c.y + rows / 2;
        assert.ok(top <= a.y + 1 + 1e-9, `${rows} rows, ${p.x},${p.y}${ins ? ', touch' : ''}: row 0 on screen (top ${top})`);
        assert.ok(bottom >= a.y + 1 + a.rows - 1e-9, `${rows} rows: the last row on screen (bottom ${bottom})`);
        // The spare rows go above the room, under the top HUD (a phone's caption, hp and buttons), so a figure on
        // a roof sits clear of it; the touch inset can only move the view up to row 0.
        if (!ins) assert.ok(Math.abs(bottom - (a.y + 1 + a.rows)) < 1e-9, `${rows} rows: the room's last row at the bottom (${bottom})`);
      }
    }
  }
});

// Fighters collide (body collision addendum), on the train's floor: every spot comes from the level.
import { doorZone, PUSH } from '../src/arena.js';
const TL = parseLevel(text), TK = levelKind(TL);
const STAND = TL.door.y; // a body standing on the floor
const X0 = TL.spawns.find((s) => s.r === TL.door.r).x; // a floor spawn in car A, open floor either side
const HEAD = BODY.h; // a body standing on another's head is this much higher
const ids = new WeakMap();
const idOf = (b) => { if (!ids.has(b)) ids.set(b, `f${Math.random().toString(36).slice(2)}`); return ids.get(b); };
const box = (b, solid = true) => ({ id: idOf(b), x: b.x, y: b.y, vx: b.vx, vy: b.vy, solid });
// Steps b for `seconds` at 60 fps against others (a list, or a function of t giving one).
const go = (b, seconds, input = IDLE, others = [], opts = {}, each = () => {}) => {
  for (let t = 0; t < seconds - 1e-9; t += 1 / 60) {
    stepBody(b, 1 / 60, typeof input === 'function' ? input(t) : input, TK, { others: typeof others === 'function' ? others(t) : others, ...opts });
    each(b, t);
  }
};
const standing = (x) => { const b = newBody(x, STAND); go(b, 0.2); assert.equal(b.y, STAND); return b; };

test('collision: PUSH is 12 cells/s; the door zone is the door\'s 3 rows in the last 2 columns, from the level', () => {
  assert.equal(PUSH, 12);
  assert.deepEqual(doorZone(TL), { x0: TL.cols - 2, x1: TL.cols, y0: TL.door.r - 2, y1: TL.door.r + 1 });
  assert.deepEqual(doorZone(TL, { x: 10, y: 5 }), { x0: TL.cols + 8, x1: TL.cols + 10, y0: TL.door.r + 3, y1: TL.door.r + 6 });
});

test('collision: walking into a standing body stops at contact, both ways; a knockback stops there too', () => {
  const o = standing(X0 + 5);
  const b = standing(X0);
  go(b, 1, { ...IDLE, x: 1, run: true }, [box(o)]);
  assert.ok(Math.abs(b.x - (o.x - BODY.w)) < 1e-9, `stopped west of it (${b.x})`);
  const w = standing(X0 + 10);
  go(w, 1, { ...IDLE, x: -1 }, [box(o)]);
  assert.ok(Math.abs(w.x - (o.x + BODY.w)) < 1e-9, `stopped east of it (${w.x})`);
  const k = standing(X0);
  knock(k, 45, 0, 0.4);
  go(k, 0.4, IDLE, [box(o)]);
  assert.ok(Math.abs(k.x - (o.x - BODY.w)) < 1e-9, `knocked into it, stopped at contact (${k.x})`);
  const free = standing(X0);
  go(free, 1, { ...IDLE, x: 1 });
  assert.ok(free.x > o.x + BODY.w, 'and without it, the same walk goes past');
});

test('collision: a falling body lands on a head and stands there, on the ground, with its air jump back, and jumps from it', () => {
  const o = standing(X0);
  const b = newBody(X0 + 0.5, STAND - 8);
  b.airJumps = 0;
  go(b, 1, IDLE, [box(o)]);
  assert.equal(b.y, o.y - HEAD, 'standing on the head');
  assert.equal(b.onGround, true);
  assert.equal(b.airJumps, AIR_JUMPS);
  let top = b.y;
  go(b, 0.3, { ...IDLE, jump: true }, [box(o)], {}, (s) => { top = Math.min(top, s.y); });
  assert.ok(top < o.y - HEAD - 4, `jumped from the head (${o.y - HEAD - top} rows)`);
  go(b, 1.5, IDLE, [box(o)]);
  assert.equal(b.y, o.y - HEAD, 'and lands back on it');
});

test('collision: ↓ drops off a head to the floor', () => {
  const o = standing(X0);
  const b = newBody(X0 + 0.3, STAND - 8);
  go(b, 1, IDLE, [box(o)]);
  assert.equal(b.y, o.y - HEAD);
  go(b, 0.05, { ...IDLE, down: true }, [box(o)]);
  go(b, 1.5, IDLE, [box(o)]);
  assert.equal(b.y, STAND, 'on the floor');
});

test('collision: jumping up from below passes through a body above, one-way, then lands on its head', () => {
  const o = newBody(X0, STAND - HEAD - 0.5); // hanging just over my head: its box is fixed
  const b = standing(X0 + 0.2);
  let top = b.y;
  const J1 = (t) => ({ ...IDLE, jump: t < 0.3 || (t > 0.45 && t < 0.7) }); // a jump, and the air jump at the top
  go(b, 0.75, J1, [box(o)], {}, (s) => { top = Math.min(top, s.y); });
  assert.ok(top < o.y - HEAD, `rose through it to above its head (${top})`);
  go(b, 1, IDLE, [box(o)]);
  assert.equal(b.y, o.y - HEAD, 'and stands on it');
  assert.equal(b.onGround, true);
});

test('collision: a rolling body passes through; so does anyone through a protected (not solid) one, and a body that is not solid itself', () => {
  const o = standing(X0 + 3);
  const r = standing(X0);
  go(r, 0.05, { ...IDLE, roll: 1 }, [box(o)]);
  go(r, 0.4, IDLE, [box(o)]);
  assert.ok(r.x > o.x + BODY.w, `rolled through (${r.x})`);
  const w = standing(X0);
  go(w, 1, { ...IDLE, x: 1 }, [box(o, false)]);
  assert.ok(w.x > o.x + BODY.w, `walked through a protected one (${w.x})`);
  const me = standing(X0);
  go(me, 1, { ...IDLE, x: 1 }, [box(o)], { solid: false });
  assert.ok(me.x > o.x + BODY.w, `walked through it, protected myself (${me.x})`);
  const fall = newBody(X0 + 3.2, STAND - 8);
  go(fall, 1, IDLE, [box(o)], { solid: false });
  assert.equal(fall.y, STAND, 'and fell through its head');
});

test('collision: in the door rows nothing collides, whichever box is in them', () => {
  const door = doorZone(TL);
  const d = standing(TL.door.x);
  const b = standing(TL.door.x - 6);
  go(b, 1, { ...IDLE, x: 1 }, [box(d)], { door });
  assert.ok(b.x > d.x - BODY.w + 0.1, `walked into the one in the doorway (${b.x})`);
  const o = standing(door.x0 - 1); // just west of the door's columns
  const e = standing(TL.door.x);
  go(e, 1, { ...IDLE, x: -1 }, [box(o)], { door });
  assert.ok(e.x < o.x - BODY.w, `walked out of the doorway through it (${e.x})`);
  const c = standing(TL.door.x);
  go(c, 1, { ...IDLE, x: -1 }, [box(o)]);
  assert.ok(Math.abs(c.x - (o.x + BODY.w)) < 1e-9, `without the zone it blocks (${c.x})`);
});

test('collision: an overlap separates at ≤ 12 cells/s each way, then they block; walls win', () => {
  const a = standing(X0), b = standing(X0 + 0.3);
  let worst = 0;
  for (let k = 0; k < 30; k++) {
    const ax = a.x, bx = b.x;
    stepBody(a, 1 / 60, IDLE, TK, { others: [box(b)] });
    stepBody(b, 1 / 60, IDLE, TK, { others: [box(a)] });
    worst = Math.max(worst, Math.abs(a.x - ax), Math.abs(b.x - bx));
  }
  assert.ok(worst <= PUSH / 60 + 1e-9, `never faster than 12 cells/s (${worst * 60})`);
  assert.ok(b.x - a.x >= BODY.w - 1e-9, `apart (${b.x - a.x})`);
  assert.ok(a.x < X0 && b.x > X0 + 0.3, 'each away from the other\'s centre');
  go(a, 1, { ...IDLE, x: 1 }, [box(b)]);
  assert.ok(Math.abs(a.x - (b.x - BODY.w)) < 1e-9, `and then it blocks (${a.x})`);
  // Against the west wall: the wall wins, the other one moves.
  let west = Math.floor(X0);
  while (TK(west - 1, TL.door.r) !== SOLID) west--;
  const w = standing(west + BODY.w / 2), v = standing(west + BODY.w / 2 + 0.2);
  for (let k = 0; k < 30; k++) {
    stepBody(w, 1 / 60, IDLE, TK, { others: [box(v)] });
    stepBody(v, 1 / 60, IDLE, TK, { others: [box(w)] });
    assert.ok(w.x >= west + BODY.w / 2 - 1e-9, `never into the wall (${w.x})`);
  }
  assert.ok(v.x - w.x >= BODY.w - 1e-9, `apart, the other moved (${v.x - w.x})`);
});

test('collision: centres that coincide separate by the tie each other box gives', () => {
  const a = standing(X0), b = standing(X0);
  for (let k = 0; k < 30; k++) {
    stepBody(a, 1 / 60, IDLE, TK, { others: [{ ...box(b), tie: -1 }] });
    stepBody(b, 1 / 60, IDLE, TK, { others: [{ ...box(a), tie: 1 }] });
  }
  assert.ok(a.x < b.x && b.x - a.x >= BODY.w - 1e-9, `a west, b east (${a.x}, ${b.x})`);
});

// Riding, in the game's order: the rider steps first against the box from the last frame, then the one
// underneath steps the whole frame in 1/60 s steps (fighters.js). The rider must keep its spot on the head.
for (const dt of [1 / 60, 1 / 30]) {
  for (const d of [-0.5, 0.5]) {
    test(`collision: standing ${d < 0 ? 'behind' : 'ahead of'} the centre of someone who sprints off and stops, at ${Math.round(1 / dt)} fps, you ride along`, () => {
      const o = standing(X0);
      const b = newBody(X0 + d, STAND - 8);
      go(b, 1, IDLE, [box(o)]);
      assert.equal(b.y, o.y - HEAD);
      const n = Math.round(dt * 60);
      for (let k = 0; k * dt < 1.5 - 1e-9; k++) {
        const seen = box(o);
        stepBody(b, dt, IDLE, TK, { others: [seen] });
        assert.ok(b.onGround && b.y === seen.y - HEAD, `on the head at ${(k * dt).toFixed(2)} s (${b.x - seen.x}, ${b.y})`);
        assert.ok(Math.abs(b.x - seen.x - d) < 1e-6, `at its spot at ${(k * dt).toFixed(2)} s (${b.x - seen.x})`);
        for (let i = 0; i < n; i++) stepBody(o, 1 / 60, { ...IDLE, x: k * dt < 1 ? 1 : 0, run: true }, TK);
      }
      assert.ok(o.x > X0 + 30, `it sprinted (${o.x})`);
    });
  }
}

// The lowest ═ over the floor with room for two bodies side by side, from the level: its row and a column on it.
function lowLedge() {
  for (let r = TL.door.r; r > 0; r--) {
    for (let c = 0; c + 2 < TL.cols; c++) if ([0, 1, 2].every((k) => TL.cells[r * TL.cols + c + k] === PLATFORM)) return { row: r, col: c + 1 };
  }
  return null;
}

test('collision: ↓ off the head of someone standing on a ═ lands on that ═ beside them, not the ledge below', () => {
  const { row, col } = lowLedge();
  const s = newBody(col + 0.5, row - 1.5);
  go(s, 0.2);
  assert.equal(s.onPlatform, true, 'they stand on the ═');
  const b = newBody(col + 0.8, s.y - HEAD - 0.5); // just over their head, under the next ═ up
  go(b, 0.5, IDLE, [box(s)]);
  assert.equal(b.y, s.y - HEAD, 'on their head');
  for (let k = 0; k < 90; k++) {
    stepBody(b, 1 / 60, { ...IDLE, down: k < 3 }, TK, { others: [box(s)] });
    stepBody(s, 1 / 60, IDLE, TK, { others: [box(b)] });
  }
  assert.equal(b.y, row - 1.5, `on the ═ at row ${row} (${b.y})`);
  assert.equal(s.y, row - 1.5, 'and they are still on it');
  assert.ok(Math.abs(b.x - s.x) >= BODY.w - 1e-9, 'side by side');
});

test('collision: jumping up through someone standing on a ═ never shoves them sideways', () => {
  const { row, col } = lowLedge();
  const s = newBody(col + 0.5, row - 1.5);
  go(s, 0.2);
  assert.equal(s.onPlatform, true, 'standing on the ═');
  const j = standing(col + 0.7);
  const x0 = s.x;
  for (let k = 0; k < 90; k++) { // a jump and the air jump: up through them, past their head
    stepBody(j, 1 / 60, { ...IDLE, jump: k < 15 || (k > 15 && k < 35) }, TK, { others: [box(s)] });
    stepBody(s, 1 / 60, IDLE, TK, { others: [box(j)] });
    assert.equal(s.x, x0, `not shoved (frame ${k})`);
  }
  assert.ok(j.y <= s.y - HEAD && j.onGround, `and up past them (${j.y})`);
});

test('collision: bodies touching within a rounding of each other (0.05) are not pushed apart, and still block', () => {
  const a = standing(X0), b = standing(X0 + BODY.w - 0.01); // 0.01 cells in, as two rounded wire positions can be
  for (let k = 0; k < 30; k++) {
    stepBody(a, 1 / 60, IDLE, TK, { others: [box(b)] });
    stepBody(b, 1 / 60, IDLE, TK, { others: [box(a)] });
  }
  assert.equal(a.x, X0, 'a not pushed');
  assert.equal(b.x, X0 + BODY.w - 0.01, 'b not pushed');
  go(a, 0.5, { ...IDLE, x: 1 }, [box(b)]);
  assert.ok(Math.abs(a.x - (b.x - BODY.w)) < 1e-9, `walking on, a stops at contact (${a.x})`);
});
