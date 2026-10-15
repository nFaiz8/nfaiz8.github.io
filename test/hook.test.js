// The gorge's grappling hook (docs/specs/2026-10-15-arena-hook.md), and Ctrl crouching on a ═.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLevel, parseMap, levelKind } from '../src/level.js';
import { newBody, stepBody, knock, grapple, hookCast, HOOK_ACROSS, HOOK_RANGE } from '../src/arena.js';
import { indexData } from '../src/data.js';
import { buildLayout } from '../src/layout.js';
import { createWorld, step, teleport } from '../src/world.js';
import { createPvp } from '../src/pvp.js';
import { createFighters } from '../src/fighters.js';
import { ropeGlyphs } from '../src/fx.js';
import { parseMessage } from '../server/rules.js';

// 40 × 20: a floor on row 19, a ═ ledge on row 8 over columns 15–25, a ▓ block high on the left.
const rows = [];
for (let r = 0; r < 20; r++) {
  let line = ' '.repeat(40).split('');
  if (r === 19) line = line.map(() => '▓');
  if (r === 8) for (let c = 15; c <= 25; c++) line[c] = '═';
  if (r === 2) for (let c = 2; c <= 6; c++) line[c] = '▓';
  rows.push(line.join(''));
}
const T = parseLevel(rows.join('\n'), 40, 20);
const kind = levelKind(T);
const standing = (x) => { const b = newBody(x, 17.5); b.onGround = true; b.facing = 1; return b; };
const run = (b, n, input = {}, opts = {}) => { for (let k = 0; k < n; k++) stepBody(b, 1 / 60, input, kind, opts); };
// The aim (on screen, from facing right) from b's shoulder to a point.
const aimAt = (b, x, y) => Math.atan2(2 * (y - (b.y - 0.9)), x - (b.x + 0.4));

test('the hook catches the ═ up and to the right, pulls me up without gravity, and lets go with a hop that lands me on the ledge', () => {
  const b = standing(6.5);
  const c = grapple(b, aimAt(b, 20, 9), kind);
  assert.ok(c && c.hit, 'caught');
  assert.ok(b.hook && Math.abs(b.hook.y - 9) < 0.1, `on the ═'s underside: ${JSON.stringify(b.hook)}`);
  let maxVx = 0;
  for (let k = 0; k < 120; k++) { stepBody(b, 1 / 60, {}, kind); maxVx = Math.max(maxVx, Math.abs(b.vx)); }
  assert.ok(maxVx <= HOOK_ACROSS + 1e-9, `across at most ${HOOK_ACROSS}: ${maxVx}`);
  assert.equal(b.hook, null, 'let go');
  assert.ok(b.onGround && b.onPlatform, 'standing on the ledge');
  assert.equal(b.y, 8 - 1.5);
});

test('a cast at open air misses (nothing within range), and the miss reaches the full range', () => {
  const W = parseLevel(`${' '.repeat(200)}\n`.repeat(39) + '▓'.repeat(200), 200, 40);
  const b = newBody(10.5, 37.5);
  b.onGround = true;
  b.facing = 1;
  const c = grapple(b, 0, levelKind(W));
  assert.equal(c.hit, false);
  assert.equal(b.hook, null);
  assert.ok(Math.abs(c.to.x - c.from.x - HOOK_RANGE) < 0.1);
});

test('on the rope: a fresh jump lets go with a hop, ↓ lets go, a hit knocks it loose; no gravity while on it', () => {
  const j = standing(6.5);
  grapple(j, aimAt(j, 20, 9), kind);
  run(j, 6);
  const vy0 = j.vy;
  run(j, 1);
  assert.ok(Math.abs(j.vy - vy0) < 1e-9, 'the pull is steady: no gravity');
  run(j, 1, { jump: true });
  assert.equal(j.hook, null);
  assert.ok(j.vy < -20, `hopped: ${j.vy}`);
  assert.equal(j.airJumps, 1, 'the air jump is still there');
  const d = standing(6.5);
  grapple(d, aimAt(d, 20, 9), kind);
  run(d, 4);
  run(d, 1, { down: true });
  assert.equal(d.hook, null);
  const h = standing(6.5);
  grapple(h, aimAt(h, 20, 9), kind);
  run(h, 4);
  knock(h, 10, -5, 0.2);
  assert.equal(h.hook, null);
});

test('a jump pressed with the cast (↑ aims it up and jumps) doesn\'t let go; the next fresh one does', () => {
  const b = standing(6.5);
  grapple(b, aimAt(b, 20, 9), kind);
  run(b, 5, { jump: true });
  assert.ok(b.hook, 'still on the rope');
  run(b, 1);
  run(b, 1, { jump: true });
  assert.equal(b.hook, null);
});

test('a pull held up by rock lets go: the ▓ block over my head', () => {
  const b = standing(4.5);
  const c = grapple(b, -Math.PI / 2, kind);
  assert.ok(c.hit && Math.abs(b.hook.y - 3) < 0.1, JSON.stringify(b.hook));
  run(b, 90);
  assert.equal(b.hook, null);
});

test('no cast while stunned or rolling', () => {
  const s = standing(6.5);
  s.stun = 0.2;
  assert.equal(grapple(s, -1, kind), null);
  const r = standing(6.5);
  r.rollT = 0;
  assert.equal(grapple(r, -1, kind), null);
  assert.equal(hookCast(standing(6.5), -1, kind).hit, true);
});

test('Ctrl crouches on a ═ and stays on it (prone with ←/→); ↓ drops through', () => {
  const b = newBody(20.5, 6.5);
  run(b, 5);
  assert.ok(b.onGround && b.onPlatform);
  run(b, 30, { crouch: true });
  assert.equal(b.low, 1);
  assert.equal(b.y, 6.5);
  run(b, 5, { crouch: true, x: 1 });
  assert.equal(b.low, 2);
  assert.ok(Math.abs(b.vx) <= 10 + 1e-9, 'crawling speed');
  run(b, 5, { down: true });
  assert.ok(b.y > 6.6, 'dropped');
});

// ---- in the fight ----
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/photos.json', import.meta.url)));
const data = indexData(fixture, ['IMG_1003']);
const IN = { x: 0, y: 0, run: false, jump: false, down: false, fire: false, strikes: 0, roll: 0, aimUp: false, aimDown: false, mouse: null };
function setup(name, { online = true } = {}) {
  const level = parseMap(name, fs.readFileSync(new URL(`../src/${name === 'gorge' ? 'gorge' : 'arena'}.txt`, import.meta.url), 'utf8'));
  const map = buildLayout(data, { name: 'X' }, { arena: { photo: data.byId.get('IMG_1003'), level } });
  const off = { x: map.arena.x + 1, y: map.arena.y + 1 };
  const world = createWorld(map);
  const s0 = level.spawns[0];
  teleport(world, off.x + s0.x, off.y + s0.y);
  const sent = [];
  const pvp = createPvp({ world, map, level, send: (m) => { sent.push(m); return true; }, rand: () => 0.5, myId: () => 'me' });
  let now = 0;
  pvp.enter(now, online);
  if (online) pvp.onMessage({ t: 'aw', fighters: [], pk: [] }, now);
  const frames = (n, inp = {}) => { for (let k = 0; k < n; k++) { now += 1000 / 60; step(world, 1 / 60, pvp.control({ ...IN, ...inp }, now)); pvp.frame(1 / 60, now); } };
  return { world, pvp, sent, frames, off, level, get now() { return now; } };
}

test('in the gorge G casts the hook: my state carries where it caught (hx, hy), and a rope is drawn; G again lets go', () => {
  const s = setup('gorge');
  s.frames(30);
  let n = s.sent.length;
  s.frames(1, { hook: true, aimUp: true });
  const p = s.world.player;
  assert.ok(p.hook, 'caught something above');
  s.frames(3);
  const a = s.sent.slice(n).find((m) => m.t === 'a' && m.hx != null);
  assert.ok(a, 'an a with hx, hy went out');
  assert.ok(Math.abs(a.hx - (p.hook.x - s.off.x)) <= 0.05 && Math.abs(a.hy - (p.hook.y - s.off.y)) <= 0.05);
  assert.ok(parseMessage(JSON.stringify(a)), 'the server takes it');
  const rope = s.pvp.glyphs(s.now).filter((g) => '─│╱╲'.includes(g.ch));
  assert.ok(rope.length > 0, 'a rope is drawn');
  s.frames(1, { hook: true });
  assert.equal(p.hook, null);
});

test('on the train G does nothing (the hook is the gorge\'s)', () => {
  const s = setup('train', { online: false });
  s.frames(30);
  s.frames(1, { hook: true, aimUp: true });
  assert.equal(s.world.player.hook, null);
});

test('someone else on the rope: their body is pulled at the anchor they sent, and drawn with it', () => {
  const kindAt = (c, r) => kind(c, r);
  const F = createFighters({ kindAt });
  F.apply({ t: 'aj', id: 'b' }, 0);
  F.apply({ t: 'a', id: 'b', x: 6.5, y: 17.5, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 0, hx: 20, hy: 9 }, 0);
  const y0 = F.get('b').body.y;
  F.step(0.1, 100);
  const st = F.list(100)[0].state;
  assert.deepEqual(st.hook, { x: 20, y: 9 });
  assert.ok(F.get('b').body.y < y0 - 1, 'pulled up');
  F.apply({ t: 'a', id: 'b', x: 8, y: 15, vx: 0, vy: 0, f: 1, g: 0, i: 0, a: 0, ts: 120 }, 120);
  assert.equal(F.list(120)[0].state.hook, null, 'a state without hx: off the rope');
});

test('someone crouched on a ═ (bit 64, no bit 8) stays on it on my screen', () => {
  const F = createFighters({ kindAt: kind });
  F.apply({ t: 'aj', id: 'b' }, 0);
  F.apply({ t: 'a', id: 'b', x: 20.5, y: 6.5, vx: 0, vy: 0, f: 1, g: 1, i: 64, a: 0, ts: 0 }, 0);
  F.step(0.2, 200); // within the 300 ms their input holds without a new state
  const st = F.list(200)[0].state;
  assert.equal(st.low, 1);
  assert.equal(st.y, 6.5);
});

test('the rope\'s glyphs follow its slant, with the hook at the end', () => {
  const g = (to) => ropeGlyphs({ from: { x: 0, y: 0 }, to, color: [1, 1, 1], a: 1, hit: true }).map((q) => q.ch);
  assert.equal(new Set(g({ x: 10, y: 0 }).slice(0, -1)).values().next().value, '─');
  assert.equal(g({ x: 0, y: -10 })[0], '│');
  assert.equal(g({ x: 10, y: -5 })[0], '╱');
  assert.equal(g({ x: 10, y: 5 })[0], '╲');
  assert.equal(g({ x: 10, y: 0 }).at(-1), '+');
});

test('the server takes hx, hy as a pair, inside the arena, rounded to 0.1', () => {
  const a = { t: 'a', x: 10, y: 10, vx: 0, vy: 0, f: 1, g: 1, i: 0, a: 0, ts: 5 };
  assert.deepEqual(parseMessage(JSON.stringify({ ...a, hx: 20.04, hy: 9.06 })), { ...a, hx: 20, hy: 9.1 });
  assert.equal(parseMessage(JSON.stringify({ ...a, hx: 20 })), null);
  assert.equal(parseMessage(JSON.stringify({ ...a, hx: 20, hy: 9999 })), null);
  assert.equal('hx' in parseMessage(JSON.stringify(a)), false);
});
