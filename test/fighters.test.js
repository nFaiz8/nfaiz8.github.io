import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { newBody, stepBody } from '../src/arena.js';
import { createFighters } from '../src/fighters.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const kinds = levelKind(L);
const bits = (inp) => (inp.x < 0 ? 1 : 0) | (inp.x > 0 ? 2 : 0) | (inp.jump ? 4 : 0) | (inp.down ? 8 : 0) | (inp.run ? 16 : 0);

// The scripted run: right, jump onto the ═ at row 24 (cols 66–78), stand, drop through it, then turn and run left.
const script = (t) => (t < 0.2 ? { x: 1 } : t < 0.6 ? { x: 1, jump: true } : t < 0.75 ? { x: 1 } : t < 1.2 ? {} : t < 1.3 ? { down: true } : t < 1.6 ? {} : t < 2.4 ? { x: -1 } : {});
function truth() {
  const b = newBody(56.5, 27.5);
  for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
  const out = [];
  for (let k = 0; k <= 180; k++) {
    const t = k / 60, inp = script(t);
    out.push({ t, x: b.x, y: b.y, vx: b.vx, vy: b.vy, g: b.onGround ? 1 : 0, onPlatform: b.onPlatform, i: bits(inp) });
    stepBody(b, 1 / 60, inp, kinds);
  }
  return out;
}
let seed = 7;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

function playback() {
  const T = truth();
  assert.ok(T.some((s) => s.onPlatform), 'the script lands on a platform');
  assert.ok(T.some((s, k) => k > 0 && T[k - 1].onPlatform && !s.g), 'and drops through it');
  // Sender: every 67 ms, plus at once on an input-bit or ground change (30 ms apart at least).
  const sends = [];
  let lastAt = -1e9, last = null;
  for (const s of T) {
    const ms = s.t * 1000;
    const urgent = last && (s.i !== last.i || s.g !== last.g);
    if ((urgent && ms - lastAt >= 30) || ms - lastAt >= 67) { sends.push({ ...s, ts: Math.round(ms), arrive: ms + 50 + rnd() * 40 }); lastAt = ms; last = s; }
  }
  sends.sort((a, b) => a.arrive - b.arrive);
  const F = createFighters({ kindAt: kinds, rtt: () => 100 });
  F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, ...wire(sends[0]) }] }, sends[0].arrive);
  const shown = [];
  let q = 1;
  for (let ms = sends[0].arrive; ms <= 3000; ms += 1000 / 60) {
    let snap = 0; // a state never moves the drawn body by itself, unless it snaps (over 4 cells, rows counted double)
    while (q < sends.length && sends[q].arrive <= ms) {
      const a = F.list(ms)[0].state;
      F.apply({ t: 'a', id: 'b', ...wire(sends[q++]) }, ms);
      const b = F.list(ms)[0].state, jump = Math.hypot(b.x - a.x, 2 * (b.y - a.y));
      if (jump > 1e-9) { assert.ok(jump > 4, `moved ${jump} on a state without snapping`); snap = jump; }
    }
    F.step(1 / 60, ms);
    const st = F.list(ms)[0].state;
    shown.push({ ms, x: st.x, y: st.y, snap });
  }
  return { T, sends, shown };
}
const wire = (s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, f: s.vx < 0 ? -1 : 1, g: s.g, i: s.i, a: 0, ts: s.ts });

test('played back at 60 fps with 50 ms latency and jitter: smooth, close to the truth, and the jump peaks where it really did', () => {
  const { T, sends, shown } = playback();
  // The take-off is known only when its state arrives, ~87 ms late here: by then they are ~3.3 rows up,
  // over the snap limit, so that one frame snaps. Every other frame must glide.
  assert.ok(shown.filter((s) => s.snap).length <= 1, `snapped at ${shown.filter((s) => s.snap).map((s) => s.ms.toFixed(0))}`);
  const truthAt = (ms) => T[Math.min(T.length - 1, Math.max(0, Math.round(ms / (1000 / 60))))];
  for (let k = 1; k < shown.length; k++) {
    if (shown[k].snap) continue;
    const d = Math.hypot(shown[k].x - shown[k - 1].x, shown[k].y - shown[k - 1].y);
    const v = Math.max(...[-2, -1, 0, 1, 2].map((o) => { const s = truthAt(shown[k].ms + o * 16.7); return Math.hypot(s.vx, s.vy); }));
    assert.ok(d <= v / 60 + 0.3, `frame ${k}: moved ${d.toFixed(3)} at speed ${v.toFixed(1)}`);
  }
  const changes = T.filter((s, k) => k > 0 && s.i !== T[k - 1].i).map((s) => s.t * 1000);
  // Nobody can show a change before the first state sent after it arrives (50–90 ms later): until then
  // the error is the change's own motion over the latency (a take-off: ~3 rows), so it isn't bounded here.
  const known = (c) => Math.min(...sends.filter((s) => s.ts >= c - 1).map((s) => s.arrive));
  for (const s of shown) {
    if (s.ms > 2900) break;
    if (changes.some((c) => s.ms >= c && s.ms < known(c))) continue;
    const tr = truthAt(s.ms), since = Math.min(...changes.map((c) => (s.ms >= c ? s.ms - c : Infinity)));
    const err = Math.hypot(s.x - tr.x, s.y - tr.y);
    if (since > 400) assert.ok(err <= 0.2, `at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off`);
    else assert.ok(err <= 1.0, `right after a change, at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off`);
  }
  const peakTrue = Math.min(...T.filter((s) => s.t < 1).map((s) => s.y));
  const peakShown = Math.min(...shown.filter((s) => s.ms < 1150).map((s) => s.y));
  assert.ok(Math.abs(peakTrue - peakShown) <= 0.3, `peak ${peakShown} vs ${peakTrue}`);
});

const one = (F, now, o = {}) => F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ...o }] }, now);

test('silence for 300 ms releases their input: they slow to a stop', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 30, vy: 0, f: 1, g: 1, i: 2, a: 0, ts: 0 }, 0);
  for (let ms = 0; ms < 1000; ms += 1000 / 60) F.step(1 / 60, ms);
  assert.ok(Math.abs(F.list(1000)[0].state.vx) < 0.1);
  assert.ok(F.list(1000)[0].state.x < 60.5 + 30 * 0.4, 'stopped soon after 300 ms');
});

test('an error over 4 cells snaps instead of gliding', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.step(1 / 60, 16);
  F.apply({ t: 'a', id: 'b', x: 100.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 16 }, 16);
  assert.ok(Math.abs(F.list(16)[0].state.x - 100.5) < 0.01);
});

test('an h knocks the body back at once and shows hurt for the stun', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'k', n: -1, d: 22, hp: 78, kx: 45, ky: -22 }, 10);
  const s = F.list(10)[0].state;
  assert.equal(s.act, 'hurt');
  assert.equal(s.hp, 78);
  F.step(1 / 60, 26);
  assert.ok(F.list(26)[0].state.x > 60.5 + 0.5);
});

test('a remote roll (bit 32) is predicted: it covers the roll\'s distance without a correction', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 48, vy: 0, f: 1, g: 1, i: 32 | 2, a: 0, ts: 0 }, 0);
  let x0 = F.list(0)[0].state.x;
  // The state is ~50 ms old (rtt / 2), so the body has already rolled that far; the drawn fighter glides
  // after it from x0. Measured when the predicted roll ends (not after 300 ms more, which adds the age).
  let ms = 0;
  do F.step(1 / 60, (ms += 1000 / 60)); while (F.list(ms)[0].state.act === 'roll' && ms < 1000);
  assert.ok(ms <= 300, 'the roll ends on time');
  assert.ok(Math.abs(F.list(ms)[0].state.x - x0 - 14.4) <= 1.2, `${F.list(ms)[0].state.x - x0}`);
});

test('messages for unknown ids, or before aw, are ignored without throwing; the next aw rebuilds', () => {
  const F = createFighters({ kindAt: kinds });
  for (const m of [{ t: 'a', id: 'x', x: 1 }, { t: 'h', id: 'x' }, { t: 's', id: 'x' }, { t: 'k', id: 'x' }, { t: 'sp', id: 'x', x: 3, y: 4 }, { t: 'ax', id: 'x' }, { t: 'a' }, null])
    F.apply(m, 0);
  assert.deepEqual(F.list(0), []);
  one(F, 0);
  assert.equal(F.list(0).length, 1);
});

test('the offset turns wire cells into map cells', () => {
  const F = createFighters({ kindAt: (c, r) => kinds(c - 100, r - 50), offset: { x: 100, y: 50 } });
  one(F, 0);
  assert.equal(F.list(0)[0].state.x, 160.5);
  assert.equal(F.list(0)[0].state.y, 77.5);
});

test('a roll sent over several states, with latency, covers 14.4 cells once and is not restarted', () => {
  // The sender rolls right from rest at 60.5 (bit 32 for its 0.3 s), sending every 67 ms; each state arrives 60 ms later.
  const b = newBody(60.5, 27.5);
  for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
  const sends = [];
  let rollEnd = null;
  for (let k = 0; k <= 60; k++) {
    const ms = Math.round(k * 1000 / 60);
    if (k % 4 === 0) sends.push({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, f: 1, g: b.onGround ? 1 : 0, i: b.rollT >= 0 || k === 0 ? 32 : 0, a: 0, ts: ms });
    stepBody(b, 1 / 60, k === 0 ? { roll: 1 } : {}, kinds);
    if (rollEnd == null && b.rollT < 0) rollEnd = b.x;
  }
  const end = b.x;
  const F = createFighters({ kindAt: kinds, rtt: () => 120 });
  one(F, 0, { x: 60.5 });
  let q = 0, maxCorr = 0; // the largest new error a later state reveals
  for (let ms = 0; ms <= 1000; ms += 1000 / 60) {
    while (q < sends.length && sends[q].ts + 60 <= ms) {
      const before = F.list(ms)[0].state.x, c0 = F.get('b').corr.x;
      F.apply({ t: 'a', id: 'b', ...sends[q++] }, ms);
      if (q > 1) maxCorr = Math.max(maxCorr, Math.abs(F.get('b').corr.x - c0)); // the first is the age, unavoidable
      assert.ok(Math.abs(F.list(ms)[0].state.x - before) < 1e-9, 'a new state never moves the drawn body by itself');
    }
    F.step(1 / 60, ms);
  }
  assert.ok(Math.abs(rollEnd - 60.5 - 14.4) < 0.01, `the sender rolled ${rollEnd - 60.5}`);
  assert.ok(Math.abs(F.list(1000)[0].state.x - end) <= 0.05, `${F.list(1000)[0].state.x} vs ${end}`);
  assert.ok(maxCorr <= 0.3, `later states corrected up to ${maxCorr.toFixed(2)}`);
});

test('the act shows the roll while the body rolls', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 48, vy: 0, f: 1, g: 1, i: 32, a: 0, ts: 0 }, 0);
  F.step(1 / 60, 16);
  assert.equal(F.list(16)[0].state.act, 'roll');
  for (let ms = 32; ms <= 500; ms += 16) F.step(0.016, ms);
  assert.equal(F.list(500)[0].state.act, 'idle');
});

test('s: shoot, its gun, and facing and aim from the absolute angle; firing ends protection', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0, { safe: 1 });
  assert.equal(F.list(0)[0].state.safe, true);
  F.apply({ t: 's', id: 'b', n: 1, x: 60, y: 27, a: Math.PI - 0.3, w: 'r' }, 100);
  let s = F.list(100)[0].state;
  assert.equal(s.act, 'shoot');
  assert.equal(s.gun, 'rifle');
  assert.equal(s.facing, -1);
  assert.ok(Math.abs(s.aim - 0.3) < 1e-9);
  assert.equal(s.aimed, true);
  assert.equal(s.safe, false);
  assert.equal(F.list(250)[0].state.actT.toFixed(2), '0.15');
  assert.equal(F.list(301)[0].state.act, 'idle', 'shoot lasts ACT_TIME.shoot');
  F.apply({ t: 's', id: 'b', n: 2, x: 60, y: 27, a: -0.5, w: 'd' }, 400);
  s = F.list(400)[0].state;
  assert.equal(s.facing, 1);
  assert.ok(Math.abs(s.aim + 0.5) < 1e-9);
});

test('w, mm, aj, ax and the kill count', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'w', id: 'b', w: 'n', ammo: 5 }, 0);
  assert.equal(F.list(0)[0].state.gun, 'sniper');
  F.apply({ t: 'mm', id: 'b', k: 'k' }, 0);
  assert.equal(F.list(390)[0].state.act, 'kick');
  assert.equal(F.list(410)[0].state.act, 'idle');
  F.apply({ t: 'mm', id: 'b', k: 'p' }, 500);
  assert.equal(F.list(500)[0].state.act, 'punch');
  F.apply({ t: 'aj', id: 'c', hp: 100, kills: 0 }, 600);
  assert.deepEqual(F.ids().sort(), ['b', 'c']);
  F.apply({ t: 'k', id: 'c', by: 'b', kills: 3 }, 700);
  assert.equal(F.get('b').kills, 3);
  F.apply({ t: 'ax', id: 'c' }, 800);
  assert.deepEqual(F.ids(), ['b']);
  F.clear();
  assert.deepEqual(F.list(900), []);
});

test('k: dead until sp, stepped with no input; sp snaps, protects for 1.5 s, full hp', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0, { vx: 30, i: 2 });
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'd', n: 1, d: 25, hp: 0, kx: 10, ky: 0 }, 0);
  F.apply({ t: 'k', id: 'b', by: 'a', kills: 1 }, 0);
  for (let ms = 0; ms < 2000; ms += 1000 / 60) F.step(1 / 60, ms);
  let r = F.list(2000)[0];
  assert.equal(r.alive, false);
  assert.equal(r.state.act, 'dead');
  assert.equal(r.state.vx, 0, 'no input while dead');
  F.apply({ t: 'a', id: 'b', x: 10.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 2000 }, 2000);
  assert.ok(F.list(2000)[0].state.x > 50, 'a stray state while dead is ignored');
  F.apply({ t: 'sp', id: 'b', x: 20.5, y: 27.5 }, 2100);
  r = F.list(2100)[0];
  assert.equal(r.alive, true);
  assert.equal(r.state.x, 20.5);
  assert.equal(r.state.act, 'idle');
  assert.equal(r.state.hp, 100);
  assert.equal(r.state.safe, true);
  assert.equal(F.list(3599)[0].state.safe, true);
  assert.equal(F.list(3601)[0].state.safe, false);
});

test('a bullet hit adds to vy and does not cancel a jump; hp regenerates by regenHp', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0, { y: 20.5, vy: -30, g: 0, i: 4 });
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'd', n: 1, d: 25, hp: 75, kx: 10, ky: -2 }, 0);
  assert.equal(F.get('b').body.vy, -32);
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'p', n: -1, d: 14, hp: 61, kx: 25, ky: -10 }, 0);
  assert.equal(F.get('b').body.vy, -10, 'a strike replaces vy');
  assert.equal(F.list(4000)[0].state.hp, 61);
  assert.equal(F.list(5000)[0].state.hp, 81);
  assert.equal(F.list(9000)[0].state.hp, 100);
});

test('aim is smoothed over 60 ms', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  assert.equal(F.list(0)[0].state.aimed, false);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0.6, ts: 0 }, 0);
  F.step(0.06, 60);
  const a = F.list(60)[0].state.aim;
  assert.ok(Math.abs(a - 0.6 * (1 - Math.exp(-1))) < 1e-6, `${a}`);
  for (let ms = 76; ms < 600; ms += 16) F.step(0.016, ms);
  assert.ok(Math.abs(F.list(600)[0].state.aim - 0.6) < 0.01);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 27.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 600 }, 600);
  for (let ms = 616; ms < 1200; ms += 16) F.step(0.016, ms);
  assert.equal(F.list(1200)[0].state.aimed, false, 'not aimed once the wire aim is back to 0');
});
