import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, AIR, PLATFORM, SOLID } from '../src/arena.js';

const text = fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8');

test('the level file is 34 lines of 160 characters, using only space, ═, ▓ and the S, R, N markers', () => {
  const lines = text.replace(/\n$/, '').split('\n');
  assert.equal(lines.length, 34);
  lines.forEach((l, i) => {
    assert.equal([...l].length, 160, `line ${i + 1}`);
    assert.match(l, /^[ ═▓SRN]*$/, `line ${i + 1}`);
  });
});

test('the 4 columns by the door are clear in the bottom 3 rows', () => {
  const L = parseLevel(text);
  for (let r = L.rows - 3; r < L.rows; r++) for (let c = L.cols - 4; c < L.cols; c++) assert.equal(L.cells[r * L.cols + c], AIR, `${c},${r}`);
});

test('every platform and every block top can be reached from the floor', () => {
  // A standing spot reaches another if it is at most 5 rows up and within 12 columns (a jump is ~6 rows).
  const L = parseLevel(text);
  const at = (c, r) => (r < 0 ? AIR : L.cells[r * L.cols + c]);
  const surfaces = [{ row: L.rows, x0: 0, x1: L.cols - 1 }]; // the floor
  for (let r = 0; r < L.rows; r++) {
    let s = -1;
    for (let c = 0; c <= L.cols; c++) {
      const top = c < L.cols && at(c, r) !== AIR && at(c, r - 1) === AIR;
      if (top && s < 0) s = c;
      if (!top && s >= 0) { surfaces.push({ row: r, x0: s, x1: c - 1 }); s = -1; }
    }
  }
  const clear = (a, b) => {
    for (let c = Math.max(a.x0, b.x0 - 12); c <= Math.min(a.x1, b.x1 + 12); c++) {
      let ok = true;
      for (let k = 1; k <= 9 && ok; k++) ok = a.row - k < 0 || at(c, a.row - k) !== SOLID;
      if (ok) return true;
    }
    return false;
  };
  const gap = (a, b) => Math.max(0, Math.max(a.x0, b.x0) - Math.min(a.x1, b.x1));
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const i = queue.shift();
    surfaces.forEach((s, j) => {
      if (!seen.has(j) && surfaces[i].row - s.row <= 5 && gap(surfaces[i], s) <= 12 && clear(surfaces[i], s)) { seen.add(j); queue.push(j); }
    });
  }
  const lost = surfaces.filter((_, j) => !seen.has(j)).map((s) => `row ${s.row} cols ${s.x0}-${s.x1}`);
  assert.deepEqual(lost, []);
});

test('headroom: the 3 cells above every standing spot are air (no ▓ and no ═); no standing spot in rows 0–2', () => {
  const L = parseLevel(text);
  const at = (c, r) => L.cells[r * L.cols + c];
  for (let r = 0; r < L.rows; r++) for (let c = 0; c < L.cols; c++) {
    if (r === 0 || at(c, r) === AIR || at(c, r - 1) !== AIR) continue; // only tops of surfaces; the ceiling above row 0 is solid, so a ▓ touching it has no top
    assert.ok(r >= 3, `standing spot at row ${r - 1}, col ${c}`);
    for (let k = 1; k <= 3; k++) assert.equal(at(c, r - k), AIR, `headroom at ${c},${r - k}`);
  }
});

test('the gap under any ▓ is 0 or at least 3 rows', () => {
  const L = parseLevel(text);
  const at = (c, r) => (r >= L.rows ? SOLID : L.cells[r * L.cols + c]);
  for (let c = 0; c < L.cols; c++) for (let r = 0; r < L.rows; r++) {
    if (at(c, r) !== SOLID || at(c, r + 1) === SOLID) continue;
    let gap = 0;
    while (r + 1 + gap < L.rows && at(c, r + 1 + gap) === AIR) gap++;
    if (r + 1 + gap >= L.rows) continue; // over the room's floor: the track bed is 4+ rows
    assert.ok(gap === 0 || gap >= 3, `a ${gap}-row slot under ▓ at ${c},${r}`);
  }
});

test('parseLevel: ═ is a platform, ▓ is solid, anything else is air, and short input is padded', () => {
  const L = parseLevel('═▓x\n');
  assert.equal(L.cols, 160);
  assert.equal(L.rows, 34);
  assert.deepEqual([...L.cells.slice(0, 4)], [PLATFORM, SOLID, AIR, AIR]);
  assert.equal(L.cells[33 * 160 + 159], AIR);
});

import { newBody, stepBody, sideCamera, coverCrop, knock, startRoll, BODY, ROLL, RUN, SPRINT, JUMP_V, GRAVITY, DOUBLE_V, AIR_JUMPS } from '../src/arena.js';

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
  assert.equal(tall.y, a.y + a.h / 2, 'a tall view shows the whole room, centred');
});

test('coverCrop keeps the middle of the image at the room shape (cells are twice as tall as wide)', () => {
  assert.deepEqual(coverCrop(2400, 500, 240, 50), { sx: 600, sy: 0, sw: 1200, sh: 500 });
  const wide = coverCrop(5066, 2075, 240, 50);
  assert.ok(Math.abs(wide.sw / wide.sh - 2.4) < 1e-9 && wide.sy === 0 && Math.abs(wide.sx - (5066 - wide.sw) / 2) < 1e-9);
  const tall = coverCrop(1000, 1000, 240, 50);
  assert.ok(Math.abs(tall.sw / tall.sh - 2.4) < 1e-9 && tall.sx === 0 && tall.sy > 0);
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

import { nearArena } from '../src/arena.js';

test('nearArena: the corridor and the room are near; spawn and the rest of the gallery are not', () => {
  const json = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
  const d = indexData(json, ['IMG_1003']);
  const map = buildLayout(d, { name: 'Faiz' }, { arena: { photo: d.byId.get('IMG_1003'), level: parseLevel(text) } });
  const a = map.arena;
  assert.ok(nearArena(map, { x: a.door.x + 5, y: a.door.y + 1.5 }), 'in the corridor');
  assert.ok(nearArena(map, { x: a.x + 40, y: a.floorY - 1 }), 'inside');
  assert.ok(!nearArena(map, map.spawn), `spawn (${map.spawn.x - a.door.x} cells east of the door)`);
  assert.ok(!nearArena(map, { x: a.door.x + 5, y: a.y - 20 }), 'north of it');
  assert.ok(!nearArena(map, { x: a.door.x + 5, y: a.floorY + 20 }), 'south of it');
  assert.ok(!nearArena({ ...map, arena: null }, map.spawn), 'no arena');
});

import { blockGlyph } from '../src/arena.js';

test('blockGlyph: a ▓ block is drawn as its outline, its inside left clear so the photo shows', () => {
  const L = parseLevel([' '.repeat(6), ' ▓▓▓▓ ', ' ▓▓▓▓ ', ' ▓▓▓▓ ', ' '.repeat(6)].join('\n'), 6, 5);
  const row = (r) => [...Array(6)].map((_, c) => blockGlyph(L, c, r) || ' ').join('');
  assert.deepEqual([1, 2, 3].map(row), [' ┌──┐ ', ' │  │ ', ' └──┘ ']);
  assert.equal(blockGlyph(L, 0, 0), null, 'air');
});
