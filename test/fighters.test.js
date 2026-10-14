import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, levelKind } from '../src/level.js';
import { newBody, stepBody, AIR_JUMPS, JUMP_V } from '../src/arena.js';
import { createFighters } from '../src/fighters.js';
import { arenaTicker } from '../src/live.js';

const L = parseLevel(fs.readFileSync(new URL('../src/arena.txt', import.meta.url), 'utf8'));
const kinds = levelKind(L);
const bits = (inp) => (inp.x < 0 ? 1 : 0) | (inp.x > 0 ? 2 : 0) | (inp.jump ? 4 : 0) | (inp.down ? 8 : 0) | (inp.run ? 16 : 0);

// The scripted run: right, jump onto the gangway's ═ at row 21 (cols 98–103), stand, drop through it, then turn and run left.
const script = (t) => (t < 0.2 ? { x: 1 } : t < 0.6 ? { x: 1, jump: true } : t < 0.75 ? { x: 1 } : t < 1.2 ? {} : t < 1.3 ? { down: true } : t < 1.6 ? {} : t < 2.4 ? { x: -1 } : {});
function truth() {
  const b = newBody(84.5, 24.5);
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
    while (q < sends.length && sends[q].arrive <= ms) {
      const a = F.list(ms)[0].state;
      F.apply({ t: 'a', id: 'b', ...wire(sends[q++]) }, ms);
      const b = F.list(ms)[0].state;
      assert.ok(Math.hypot(b.x - a.x, b.y - a.y) < 1e-9, `at ${ms.toFixed(0)} ms a state snapped the drawn body`);
    }
    F.step(1 / 60, ms);
    const st = F.list(ms)[0].state;
    shown.push({ ms, x: st.x, y: st.y });
  }
  return { T, sends, shown };
}
const wire = (s) => ({ x: s.x, y: s.y, vx: s.vx, vy: s.vy, f: s.vx < 0 ? -1 : 1, g: s.g, i: s.i, a: 0, ts: s.ts });

test('played back at 60 fps with 50 ms latency and jitter: smooth, close to the truth, and the jump peaks where it really did', () => {
  const { T, sends, shown } = playback();
  const truthAt = (ms) => T[Math.min(T.length - 1, Math.max(0, Math.round(ms / (1000 / 60))))];
  const changes = T.filter((s, k) => k > 0 && s.i !== T[k - 1].i).map((s) => s.t * 1000);
  // Within 200 ms of an input change a frame also carries the gliding correction (a take-off: ~3 rows).
  for (let k = 1; k < shown.length; k++) {
    const d = Math.hypot(shown[k].x - shown[k - 1].x, shown[k].y - shown[k - 1].y);
    const v = Math.max(...[-2, -1, 0, 1, 2].map((o) => { const s = truthAt(shown[k].ms + o * 16.7); return Math.hypot(s.vx, s.vy); }));
    const gliding = changes.some((c) => shown[k].ms >= c && shown[k].ms - c <= 200);
    assert.ok(d <= v / 60 + (gliding ? 0.6 : 0.3), `frame ${k}: moved ${d.toFixed(3)} at speed ${v.toFixed(1)}`);
  }
  // Nobody can show a change before the first state sent after it arrives (50–90 ms later): until then
  // the error is the change's own motion over the latency (a take-off: ~3 rows), so it isn't bounded here.
  // Once it arrives, that error glides out (spec §7: "glides back in about 80 ms") on top of the 1.0 allowance.
  const known = (c) => Math.min(...sends.filter((s) => s.ts >= c - 1).map((s) => s.arrive));
  const unknown = new Map(); // change → the error on its last frame before it was known
  for (const s of shown) {
    if (s.ms > 2900) break;
    const tr = truthAt(s.ms), since = Math.min(...changes.map((c) => (s.ms >= c ? s.ms - c : Infinity)));
    const err = Math.hypot(s.x - tr.x, s.y - tr.y);
    const blind = changes.filter((c) => s.ms >= c && s.ms < known(c));
    if (blind.length) { for (const c of blind) unknown.set(c, err); continue; }
    const glide = Math.max(0, ...changes.filter((c) => s.ms >= c && unknown.has(c)).map((c) => unknown.get(c) * Math.exp(-(s.ms - known(c)) / 80)));
    if (since > 400) assert.ok(err <= 0.2, `at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off`);
    else assert.ok(err <= 1.0 + glide, `right after a change, at ${s.ms.toFixed(0)} ms: ${err.toFixed(3)} off (glide ${glide.toFixed(3)})`);
  }
  const peakTrue = Math.min(...T.filter((s) => s.t < 1).map((s) => s.y));
  const peakShown = Math.min(...shown.filter((s) => s.ms < 1150).map((s) => s.y));
  assert.ok(Math.abs(peakTrue - peakShown) <= 0.3, `peak ${peakShown} vs ${peakTrue}`);
});

test('a remote jump seen 50 ms late glides onto its arc: no frame jumps more than 1.5 cells', () => {
  // The sender stands, then jumps (right, then straight up); states every 67 ms or at once on a change, 50 ms on the way.
  const b = newBody(60.5, 24.5);
  for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
  const sends = [];
  let lastAt = -1e9, last = null;
  for (let k = 0; k <= 90; k++) {
    const ms = k * 1000 / 60, inp = k < 12 ? {} : k < 40 ? { jump: true, x: k < 24 ? 1 : 0 } : {};
    const s = { x: b.x, y: b.y, vx: b.vx, vy: b.vy, f: 1, g: b.onGround ? 1 : 0, i: bits(inp), a: 0, ts: Math.round(ms) };
    const urgent = last && (s.i !== last.i || s.g !== last.g);
    if ((urgent && ms - lastAt >= 30) || ms - lastAt >= 67) { sends.push(s); lastAt = ms; last = s; }
    stepBody(b, 1 / 60, inp, kinds);
  }
  const F = createFighters({ kindAt: kinds, rtt: () => 100 });
  one(F, 0);
  let q = 0, prev = F.list(0)[0].state, worst = 0;
  for (let ms = 0; ms <= 1500; ms += 1000 / 60) {
    while (q < sends.length && sends[q].ts + 50 <= ms) F.apply({ t: 'a', id: 'b', ...sends[q++] }, ms);
    F.step(1 / 60, ms);
    const st = F.list(ms)[0].state;
    worst = Math.max(worst, Math.hypot(st.x - prev.x, st.y - prev.y));
    prev = st;
  }
  assert.ok(Math.min(...sends.map((s) => s.y)) < 24, 'the sender really jumped');
  assert.ok(worst <= 1.5, `a frame moved ${worst.toFixed(3)}`);
});

const one = (F, now, o = {}) => F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ...o }] }, now);

test('silence for 300 ms releases their input: they slow to a stop', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 30, vy: 0, f: 1, g: 1, i: 2, a: 0, ts: 0 }, 0);
  for (let ms = 0; ms < 1000; ms += 1000 / 60) F.step(1 / 60, ms);
  assert.ok(Math.abs(F.list(1000)[0].state.vx) < 0.1);
  assert.ok(F.list(1000)[0].state.x < 60.5 + 30 * 0.4, 'stopped soon after 300 ms');
});

test('an error over 4 cells snaps instead of gliding', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.step(1 / 60, 16);
  F.apply({ t: 'a', id: 'b', x: 100.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 16 }, 16);
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
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 48, vy: 0, f: 1, g: 1, i: 32 | 2, a: 0, ts: 0 }, 0);
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
  assert.equal(F.list(0)[0].state.y, 74.5);
});

test('a roll sent over several states, with latency, covers 14.4 cells once and is not restarted', () => {
  // The sender rolls right from rest at 60.5 (bit 32 for its 0.3 s), sending every 67 ms; each state arrives 60 ms later.
  const b = newBody(60.5, 24.5);
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
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 48, vy: 0, f: 1, g: 1, i: 32, a: 0, ts: 0 }, 0);
  F.step(1 / 60, 16);
  assert.equal(F.list(16)[0].state.act, 'roll');
  for (let ms = 32; ms <= 500; ms += 16) F.step(0.016, ms);
  assert.equal(F.list(500)[0].state.act, 'idle');
});

test('s: shoot, its gun, and facing and aim from the absolute angle; firing ends protection', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0, { safe: 1 });
  assert.equal(F.list(0)[0].state.safe, true);
  F.apply({ t: 's', id: 'b', n: 1, x: 60, y: 24, a: Math.PI - 0.3, w: 'r' }, 100);
  let s = F.list(100)[0].state;
  assert.equal(s.act, 'shoot');
  assert.equal(s.gun, 'rifle');
  assert.equal(s.facing, -1);
  assert.ok(Math.abs(s.aim - 0.3) < 1e-9);
  assert.equal(s.aimed, true);
  assert.equal(s.safe, false);
  assert.equal(F.list(250)[0].state.actT.toFixed(2), '0.15');
  assert.equal(F.list(301)[0].state.act, 'idle', 'shoot lasts ACT_TIME.shoot');
  F.apply({ t: 's', id: 'b', n: 2, x: 60, y: 24, a: -0.5, w: 'd' }, 400);
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
  F.apply({ t: 'a', id: 'b', x: 10.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 2000 }, 2000);
  assert.ok(F.list(2000)[0].state.x > 50, 'a stray state while dead is ignored');
  F.apply({ t: 'sp', id: 'b', x: 20.5, y: 24.5 }, 2100);
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
  one(F, 0, { y: 17.5, vy: -30, g: 0, i: 4 });
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
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0.6, ts: 0 }, 0);
  F.step(0.06, 60);
  const a = F.list(60)[0].state.aim;
  assert.ok(Math.abs(a - 0.6 * (1 - Math.exp(-1))) < 1e-6, `${a}`);
  for (let ms = 76; ms < 600; ms += 16) F.step(0.016, ms);
  assert.ok(Math.abs(F.list(600)[0].state.aim - 0.6) < 0.01);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 600 }, 600);
  for (let ms = 616; ms < 1200; ms += 16) F.step(0.016, ms);
  assert.equal(F.list(1200)[0].state.aimed, false, 'not aimed once the wire aim is back to 0');
});

test('a re-entry aj for a known id starts fresh: its restarted ts is not dropped as old', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  for (let ts = 0; ts <= 60000; ts += 10000) F.apply({ t: 'a', id: 'b', x: 60.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts }, ts + 50);
  F.apply({ t: 'aj', id: 'b', hp: 100, kills: 2 }, 61000);
  F.apply({ t: 'a', id: 'b', x: 20.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 50 }, 61050);
  const r = F.list(61050)[0];
  assert.equal(r.state.x, 20.5);
  assert.equal(r.kills, 2);
  assert.equal(r.state.safe, true);
});

test('a popped fighter that re-enters (aj) is alive again', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  F.apply({ t: 'k', id: 'b', by: 'a', kills: 1 }, 100);
  F.apply({ t: 'aj', id: 'b', hp: 100, kills: 0 }, 200);
  F.apply({ t: 'a', id: 'b', x: 30.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 5 }, 250);
  const r = F.list(250)[0];
  assert.equal(r.alive, true);
  assert.notEqual(r.state.act, 'dead');
  assert.equal(r.state.hp, 100);
  assert.equal(r.state.x, 30.5);
});

test('a hurt fighter from aw keeps its hp and regenerates from it', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0, { hp: 40 });
  assert.equal(F.list(0)[0].state.hp, 40);
  assert.equal(F.list(1000)[0].state.hp, 60);
});

// The double jump (headshots and double jump addendum §2). The sender as the page runs it: this frame's
// input, then the step, then the ticker (urgent on an input-bit or ground change, 30 ms apart at least),
// so a state already carries the jump its bit started. At the times in `forced` a state goes out ahead of
// the step instead, as pvp.js forces one out ahead of a shot, and stands in for the ticker's next urgent send.
function sender(start, script, { frames = 150, forced = [] } = {}) {
  const b = newBody(start.x, start.y);
  for (let i = 0; i < 12; i++) stepBody(b, 1 / 60, {}, kinds);
  const T = [], sends = [];
  let ahead = null;
  const tick = arenaTicker((m) => {
    const f = ahead;
    ahead = null;
    if (f && m.ts - f.ts < 30 && m.i === f.i && m.g === f.g) return true;
    sends.push(m);
    return true;
  });
  for (let k = 0; k <= frames; k++) {
    const ms = (k * 1000) / 60, inp = script(ms);
    const snap = () => ({ x: b.x, y: b.y, vx: b.vx, vy: b.vy, f: 1, g: b.onGround ? 1 : 0, i: bits(inp), a: 0, ts: Math.round(ms) });
    if (forced.some((t) => Math.abs(t - ms) < 1)) { ahead = { t: 'a', ...snap() }; sends.push(ahead); }
    stepBody(b, 1 / 60, inp, kinds);
    tick(snap(), ms);
    T.push({ ms, x: b.x, y: b.y, vy: b.vy, g: b.onGround, flipT: b.t - b.airJumpT, airJumps: b.airJumps });
  }
  return { T, sends };
}
// Played back 50 ms late at 60 fps: what is shown each frame, and the fighter's state then.
function watch({ T, sends }, start, late = 50) {
  const F = createFighters({ kindAt: kinds, rtt: () => 2 * late });
  F.apply({ t: 'aw', fighters: [{ id: 'b', hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x: start.x, y: start.y, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0 }] }, 0);
  const shown = [];
  let q = 0;
  for (let k = 0; k <= T.length - 1; k++) {
    const ms = (k * 1000) / 60;
    F.step(1 / 60, ms);
    while (q < sends.length && sends[q].ts + late <= ms + 1e-6) F.apply({ id: 'b', ...sends[q++] }, ms);
    const st = F.list(ms)[0].state;
    shown.push({ ms, x: st.x, y: st.y, flipT: st.flipT, airJumps: F.get('b').body.airJumps, vy: F.get('b').body.vy });
  }
  return shown;
}
const press = (on) => (ms) => ({ jump: on.some(([a, b]) => ms >= a && ms < b) });

test('a remote double jump is predicted from the bit edges: the ground jump is not taken for it, the air jump is, and it peaks where it really did', () => {
  const start = { x: 60.5, y: 24.5 };
  // Jump, let go while rising, the air jump just after the top, let go while rising again, then a third press (nothing).
  const run = sender(start, press([[200, 350], [450, 600], [700, 760]]));
  const { T } = run, shown = watch(run, start);
  const airAt = T.find((s) => s.airJumps === 0).ms; // the sender's air jump
  assert.ok(Math.abs(airAt - 450) < 20, `the sender's air jump at ${airAt}`);
  // Until the state with the air jump's bit arrives, no flip; after it, the flip's clock is the sender's,
  // late by no more than the ticker's 30 ms gap.
  const known = run.sends.find((m) => m.ts >= airAt - 1).ts + 50;
  for (const s of shown) {
    const tr = T[Math.round(s.ms / (1000 / 60))];
    if (s.ms + 1e-6 < known) assert.equal(s.flipT, Infinity, `no flip yet at ${s.ms.toFixed(0)} ms`);
    else if (tr.airJumps === 0) assert.ok(s.flipT <= tr.flipT + 1e-9 && s.flipT >= tr.flipT - 0.035, `flipT ${s.flipT} vs ${tr.flipT} at ${s.ms.toFixed(0)} ms`);
  }
  // Close to the truth once each change has been known for 150 ms, and the same peaks.
  const changes = [200, 350, 450, 600, 700, 760];
  for (const s of shown) {
    const tr = T[Math.round(s.ms / (1000 / 60))];
    if (changes.some((c) => s.ms >= c && s.ms < c + 50 + 150)) continue;
    assert.ok(Math.hypot(s.x - tr.x, s.y - tr.y) <= 0.3, `at ${s.ms.toFixed(0)} ms: ${Math.hypot(s.x - tr.x, s.y - tr.y).toFixed(3)} off`);
  }
  const peak = (a, from, to) => Math.min(...a.filter((s) => s.ms >= from && s.ms < to).map((s) => s.y));
  const truePeak = peak(T, 450, 1000), shownPeak = peak(shown, 450, 1100);
  assert.ok(truePeak < peak(T, 0, 450) - 3, 'the air jump went higher');
  assert.ok(Math.abs(truePeak - shownPeak) <= 0.3, `peak ${shownPeak} vs ${truePeak}`);
});

test('a remote air jump whose state went out ahead of its step (ahead of a shot) is predicted too', () => {
  const start = { x: 60.5, y: 24.5 };
  const run = sender(start, press([[200, 350], [450, 600]]), { forced: [450] });
  assert.ok(run.sends.some((m) => m.ts === 450 && m.i === 4 && m.vy > 0), 'the forced state: the bit on, still falling');
  const { T } = run, shown = watch(run, start);
  const peak = (a, from, to) => Math.min(...a.filter((s) => s.ms >= from && s.ms < to).map((s) => s.y));
  assert.ok(Math.abs(peak(T, 450, 1000) - peak(shown, 450, 1100)) <= 0.3, `peak ${peak(shown, 450, 1100)} vs ${peak(T, 450, 1000)}`);
  assert.ok(shown.some((s) => s.flipT < 0.36), 'the flip shows');
});

test('a remote jump just after running off a ledge (coyote time) is the ground jump, not the air jump', () => {
  const start = { x: 101.5, y: 19.5 }; // on the gangway's ═ at row 21, cols 98–103
  // Run right off the edge, and jump 50 ms after leaving it.
  const go = (left) => sender(start, (ms) => ({ x: 1, jump: left != null && ms >= left + 50 && ms < left + 300 }), { frames: 60 });
  const left = go(null).T.find((s) => !s.g).ms;
  const again = go(left);
  const shown = watch(again, start);
  assert.ok(Math.min(...again.T.map((s) => s.vy)) < -JUMP_V + 3, 'the sender took the ground jump');
  assert.equal(again.T.at(-1).airJumps, AIR_JUMPS);
  assert.ok(shown.every((s) => s.flipT === Infinity), 'no flip');
  assert.equal(shown.at(-1).airJumps, AIR_JUMPS, 'the air jump is still there');
  // Once the jump's state is in, the predicted body moves as the sender's did (an air jump would be ~4 rows/s slower).
  const jumpAt = again.T.findIndex((s) => s.vy < -20) * (1000 / 60);
  const known = again.sends.find((m) => m.ts >= jumpAt - 1).ts + 50;
  const k = shown.findIndex((s) => s.ms + 1e-6 >= known);
  assert.ok(Math.abs(shown[k].vy - again.T[k].vy) < 0.2, `the predicted take-off (${shown[k].vy} vs ${again.T[k].vy})`);
});

test('a let-go is in the state already: the remote body does not cut the jump a second time', () => {
  const F = createFighters({ kindAt: kinds, rtt: () => 0 });
  one(F, 0, { y: 17.5, vy: -30, g: 0, i: 4 });
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 17.5, vx: 0, vy: -30, f: 1, g: 0, i: 4, a: 0, ts: 0 }, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 17, vx: 0, vy: -15, f: 1, g: 0, i: 0, a: 0, ts: 30 }, 30);
  assert.equal(F.get('b').body.vy, -15);
  F.step(1 / 60, 46);
  assert.ok(Math.abs(F.get('b').body.vy - (-15 + 133 / 60)) < 1e-9, `${F.get('b').body.vy}`);
});

test('flipT: Infinity before any air jump and after a respawn', () => {
  const F = createFighters({ kindAt: kinds });
  one(F, 0);
  assert.equal(F.list(0)[0].state.flipT, Infinity);
  F.apply({ t: 'sp', id: 'b', x: 20.5, y: 24.5 }, 100);
  assert.equal(F.list(100)[0].state.flipT, Infinity);
});

// A remote fighter in the air, then their air jump's state: flipping.
function flipping(F) {
  one(F, 0, { y: 15.5, vy: 0, g: 0, i: 0, ts: 0 });
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 15.5, vx: 0, vy: 0, f: 1, g: 0, i: 0, a: 0, ts: 0 }, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 15.6, vx: 0, vy: 5, f: 1, g: 0, i: 4, a: 0, ts: 50 }, 50);
}

test('a remote hit mid-flip ends the flip for good: flipT stays Infinity once the hurt is over, through new states', () => {
  const F = createFighters({ kindAt: kinds, rtt: () => 0 });
  flipping(F);
  F.step(1 / 60, 66);
  assert.ok(F.list(66)[0].state.flipT < 0.05, 'flipping');
  F.apply({ t: 'h', id: 'b', by: 'a', w: 'r', n: 1, d: 9, hp: 91, kx: 3, ky: 0 }, 80); // stun 0.05 s
  F.step(1 / 60, 83);
  assert.equal(F.list(83)[0].state.act, 'hurt');
  let ms = 83;
  while (ms < 200) { F.step(1 / 60, (ms += 1000 / 60)); assert.equal(F.list(ms)[0].state.flipT, Infinity, `at ${ms.toFixed(0)}`); }
  assert.notEqual(F.list(ms)[0].state.act, 'hurt');
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 13, vx: 0, vy: -10, f: 1, g: 0, i: 4, a: 0, ts: 200 }, 200);
  assert.equal(F.list(200)[0].state.flipT, Infinity, 'a new state does not bring it back');
});

test('a remote air kick, then their air jump within its 0.4 s: no flip, during the kick or after it', () => {
  const F = createFighters({ kindAt: kinds, rtt: () => 0 });
  one(F, 0, { y: 15.5, vy: 0, g: 0, i: 0, ts: 0 });
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 15.5, vx: 0, vy: 0, f: 1, g: 0, i: 0, a: 0, ts: 0 }, 0);
  F.apply({ t: 'mm', id: 'b', k: 'k' }, 0);
  F.apply({ t: 'a', id: 'b', x: 60.5, y: 15.6, vx: 0, vy: 5, f: 1, g: 0, i: 4, a: 0, ts: 100 }, 100);
  for (let ms = 100; ms <= 600; ms += 1000 / 60) {
    F.step(1 / 60, ms);
    assert.equal(F.get('b').body.airJumps, 0, 'the air jump was predicted');
    assert.equal(F.list(ms)[0].state.flipT, Infinity, `at ${ms.toFixed(0)}: ${F.list(ms)[0].state.act}`);
  }
});

// Fighters collide (body collision addendum): spots from the level.
const STAND = L.door.y, X0 = L.spawns.find((s) => s.r === L.door.r).x;
const fighter = (id, x, extra = {}) => ({ id, hp: 100, kills: 0, alive: 1, safe: 0, w: 'd', ammo: -1, x, y: STAND, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, ...extra });
const runAt = (F, ms0, ms1) => { for (let ms = ms0; ms < ms1; ms += 1000 / 60) F.step(1 / 60, ms); };

test('collision: a remote body predicted into me stops at contact; protected me, it walks through', () => {
  for (const solid of [true, false]) {
    const me = { x: X0, y: STAND, vx: 0, vy: 0, solid, id: 'me' };
    const F = createFighters({ kindAt: kinds, me: () => me });
    F.apply({ t: 'aw', fighters: [fighter('b', X0 + 6, { vx: -30, i: 1 })] }, 0);
    runAt(F, 0, 250);
    F.apply({ t: 'a', id: 'b', x: F.get('b').body.x, y: STAND, vx: -30, vy: 0, f: -1, g: 1, i: 1, a: 0, ts: 250 }, 250);
    runAt(F, 250, 1000);
    const x = F.list(1000)[0].state.x;
    if (solid) assert.ok(Math.abs(x - (X0 + 0.8)) < 1e-6, `stopped beside me (${x})`);
    else assert.ok(x < X0 - 0.8, `walked through (${x})`);
  }
});

test('collision: remote bodies collide with each other too; a protected one is passed through', () => {
  const F = createFighters({ kindAt: kinds });
  F.apply({ t: 'aw', fighters: [fighter('c', X0), fighter('b', X0 + 6, { vx: -30, i: 1 })] }, 0);
  runAt(F, 0, 250);
  const b = F.list(250).find((r) => r.id === 'b').state, c = F.list(250).find((r) => r.id === 'c').state;
  assert.ok(Math.abs(b.x - (c.x + 0.8)) < 1e-6, `b stopped beside c (${b.x}, ${c.x})`);
  const G = createFighters({ kindAt: kinds });
  G.apply({ t: 'aw', fighters: [fighter('c', X0, { safe: 1 }), fighter('b', X0 + 6, { vx: -30, i: 1 })] }, 0);
  runAt(G, 0, 250);
  assert.ok(G.list(250).find((r) => r.id === 'b').state.x < X0 - 0.8, 'through the protected one');
});

test('collision: a correction gliding out never draws a remote body inside me (nor shoves me)', () => {
  const me = { x: X0, y: STAND, vx: 0, vy: 0, solid: true, id: 'me' };
  const F = createFighters({ kindAt: kinds, me: () => me, rtt: () => 0 });
  F.apply({ t: 'aw', fighters: [fighter('b', X0 + 3, { vx: -30, i: 1 })] }, 0);
  runAt(F, 0, 200);
  assert.ok(Math.abs(F.list(200)[0].state.x - (X0 + 0.8)) < 1e-6, 'at contact');
  // A state sent 100 ms ago that predicts them short of me: the drawn body glides back toward its old spot.
  F.apply({ t: 'a', id: 'b', x: X0 + 4.6, y: STAND, vx: -30, vy: 0, f: -1, g: 1, i: 1, a: 0, ts: 100 }, 200);
  for (let ms = 200; ms < 600; ms += 1000 / 60) {
    F.step(1 / 60, ms);
    const x = F.list(ms)[0].state.x;
    assert.ok(x >= X0 + 0.8 - 1e-9, `drawn inside me at ${ms.toFixed(0)} ms (${x})`);
  }
});

// A mover that is dead or protected passes through too (it is not only passed through).
test('collision: a remote popped above my head falls past me to the floor, not onto my head', () => {
  const me = { x: X0, y: STAND, vx: 0, vy: 0, solid: true, id: 'me' };
  const F = createFighters({ kindAt: kinds, me: () => me });
  F.apply({ t: 'aw', fighters: [fighter('b', X0 + 0.2, { y: STAND - 6, g: 0 })] }, 0);
  F.apply({ t: 'k', id: 'b', by: 'me', kills: 1 }, 0);
  runAt(F, 0, 1500);
  assert.equal(F.list(1500)[0].state.y, STAND, 'on the floor');
});

test('collision: walking through a corpse never shoves it', () => {
  const me = { x: X0 + 0.3, y: STAND, vx: 30, vy: 0, solid: true, id: 'me' };
  const F = createFighters({ kindAt: kinds, me: () => me });
  F.apply({ t: 'aw', fighters: [fighter('b', X0, { alive: 0 })] }, 0);
  runAt(F, 0, 500);
  assert.equal(F.list(500)[0].state.x, X0);
});

test('collision: a protected remote walks through me on my screen too', () => {
  const me = { x: X0, y: STAND, vx: 0, vy: 0, solid: true, id: 'me' };
  const F = createFighters({ kindAt: kinds, me: () => me });
  F.apply({ t: 'aw', fighters: [fighter('b', X0 + 6, { vx: -30, i: 1, safe: 1 })] }, 0);
  runAt(F, 0, 600);
  F.apply({ t: 'a', id: 'b', x: F.get('b').body.x, y: STAND, vx: -30, vy: 0, f: -1, g: 1, i: 1, a: 0, ts: 600 }, 600);
  runAt(F, 600, 1000);
  assert.ok(F.list(1000)[0].state.safe, 'still protected');
  assert.ok(F.list(1000)[0].state.x < X0 - 0.8, `walked through (${F.list(1000)[0].state.x})`);
});

// Crouch and crawl (docs/specs/2026-10-14-arena-crouch.md §4).
test('a remote fighter crouched (64) or crawling (128 with ↓ and →) is drawn low, and crawls at the crawl\'s speed', () => {
  const G = createFighters({ kindAt: kinds });
  G.apply({ t: 'aj', id: 'b', hp: 100, kills: 0 }, 0);
  G.apply({ t: 'a', id: 'b', x: 40.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 8 | 64, a: 0, ts: 0 }, 0);
  assert.equal(G.list(0)[0].state.low, 1);
  G.step(1 / 60, 16);
  assert.equal(G.list(16)[0].state.low, 1, 'predicted: still crouched');
  G.apply({ t: 'a', id: 'b', x: 40.5, y: 24.5, vx: 10, vy: 0, f: 1, g: 1, i: 8 | 2 | 128, a: 0, ts: 100 }, 100);
  for (let ms = 116; ms <= 200; ms += 16) G.step(0.016, ms);
  const s = G.list(200)[0].state;
  assert.equal(s.low, 2);
  assert.ok(Math.abs(s.vx - 10) < 0.01, `crawling at ${s.vx}`);
});

test('a remote fighter hit while low (lo) is stunned half as long', () => {
  const G = createFighters({ kindAt: kinds });
  G.apply({ t: 'aj', id: 'b', hp: 100, kills: 0 }, 0);
  G.apply({ t: 'a', id: 'b', x: 40.5, y: 24.5, vx: 0, vy: 0, f: 1, g: 1, i: 8 | 64, a: 0, ts: 0 }, 0);
  G.apply({ t: 'h', id: 'b', by: 'c', w: 'k', n: -1, d: 22, hp: 78, kx: 22.5, ky: -11, lo: 1 }, 10);
  assert.ok(Math.abs(G.get('b').body.stun - 0.2) < 1e-9);
});
