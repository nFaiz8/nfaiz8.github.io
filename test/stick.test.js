import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickPose, MIRROR, SHOULDER, MUZZLE_R, GUN_ART, HAND_R } from '../src/stick.js';

const base = { x: 10, y: 20, vx: 0, vy: 0, facing: 1, ground: true, aim: 0, act: 'idle', actT: 0, gun: 'deagle', landT: Infinity, spawnT: Infinity };
const pose = (s, t = 0, opts = {}) => stickPose({ ...base, ...s }, t, opts);
const part = (g, p) => g.filter((x) => x.part === p);
const head = (g) => part(g, 'head')[0];
const ASCII = /^[\x20-\x7e═╦╤°]$/;

test('shape: every pose has a head and a torso, stays in its box, and uses printable ASCII plus ═ ╦ ╤ °', () => {
  const states = [{}, { vx: 30, x: 13 }, { vx: 30, x: 16 }, { ground: false, vy: -20 }, { ground: false, vy: 0 }, { ground: false, vy: 20 }, { landT: 0.05 },
    { act: 'shoot', aim: -Math.PI / 2 }, { act: 'shoot', aim: Math.PI / 2, gun: 'sniper' }, { gun: 'rifle' }, { aimed: true, aim: -0.6, gun: 'sniper' }];
  for (const s of states) {
    const g = pose(s);
    assert.ok(head(g) && part(g, 'torso').length, JSON.stringify(s));
    for (const x of g.filter((x) => x.part !== 'gun' && x.part !== 'fx')) {
      assert.ok(Math.abs(x.dx) <= 2.5 && x.dy >= -1.6 && x.dy <= 1.2, `${x.part} ${x.ch} at ${x.dx},${x.dy} in ${JSON.stringify(s)}`);
    }
    for (const x of g) assert.match(x.ch, ASCII);
  }
});

test('purity: same input, same output; state untouched; no Math.random', () => {
  const s = { ...base, vx: 30, x: 14.2, act: 'shoot', actT: 0.02, aim: 0.4 };
  const copy = structuredClone(s);
  assert.deepEqual(stickPose(s, 1.23, { phase: 0.3 }), stickPose(s, 1.23, { phase: 0.3 }));
  assert.deepEqual(s, copy);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/stick.js', import.meta.url), 'utf8'), /Math\.random/);
});

test('mirroring: facing left is facing right with dx negated and characters swapped', () => {
  for (const s of [{}, { vx: 30, x: 14 }, { act: 'shoot', aim: -0.5, gun: 'rifle' }, { ground: false, vy: -20 }]) {
    const r = pose({ ...s, facing: 1 }, 0.7), l = pose({ ...s, facing: -1, vx: -(s.vx || 0), x: s.x ? -s.x : 10 }, 0.7);
    assert.deepEqual(l.map((g) => [g.part, +(-g.dx).toFixed(9), +g.dy.toFixed(9), MIRROR[g.ch] || g.ch]), r.map((g) => [g.part, +g.dx.toFixed(9), +g.dy.toFixed(9), g.ch]));
  }
});

test('idle breathes by at most 0.06 row; with Reduce Motion it is still', () => {
  const ys = [0, 0.6, 1.2, 1.8].map((t) => head(pose({}, t)).dy);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 0.06 + 1e-9 && Math.max(...ys) - Math.min(...ys) > 0.03);
  assert.deepEqual([0, 0.6, 1.2].map((t) => head(pose({}, t, { reducedMotion: true })).dy), [-1, -1, -1]);
});

test('run: the frame depends only on x (+3 cells the next frame, +12 back to the start); slow is idle', () => {
  const frame = (x) => part(pose({ vx: 30, x }), 'legF')[0].ch + (part(pose({ vx: 30, x }), 'armF')[0]?.ch || '');
  assert.equal(frame(13), frame(13));
  assert.notEqual(frame(13), frame(16));
  assert.equal(frame(13), frame(25));
  assert.deepEqual(pose({ vx: 1, x: 13 }).map((g) => g.ch), pose({}).map((g) => g.ch));
});

test('running backwards: no lean, and the frames play in reverse', () => {
  const fwd = pose({ vx: 30, x: 13 }), back = pose({ vx: -30, x: 13 });
  assert.ok(part(fwd, 'torso')[0].dx > 0.1);
  assert.equal(part(back, 'torso')[0].dx, 0);
  assert.equal(part(back, 'torso')[0].ch, '|');
});

test('air: rise, apex and fall poses', () => {
  const armB = (vy) => part(pose({ ground: false, vy }), 'armB')[0].ch;
  assert.deepEqual([armB(-20), armB(0), armB(20)], ['\\', '-', '\\']);
  assert.equal(part(pose({ ground: false, vy: -20 }), 'legF')[0].ch, '>');
  assert.equal(part(pose({ ground: false, vy: 20 }), 'legF')[0].ch, '\\');
});

test('land: the head is lower at landT 0.05; at 0.2 it is idle', () => {
  assert.ok(head(pose({ landT: 0.05 })).dy > head(pose({})).dy);
  assert.deepEqual(pose({ landT: 0.2 }), pose({}));
});

const ray = (s, g) => Math.atan2(2 * (g.dy - SHOULDER.dy), (g.dx - SHOULDER.dx * s.facing) * s.facing);

test('shoot: the gun lies on the ray from the shoulder at the aim, for 16 aims, apart from recoil', () => {
  for (let k = 0; k < 16; k++) {
    const aim = -Math.PI / 2 + (k + 0.5) * (Math.PI / 16);
    for (const facing of [1, -1]) {
      const s = { act: 'shoot', actT: 0.2, aim, facing };
      for (const g of part(pose(s), 'gun')) assert.ok(Math.abs(ray({ facing }, g) - aim) < 1e-6, `aim ${aim} glyph ${g.ch}`);
    }
  }
});

test('shoot: the arm glyph by angle', () => {
  const arm = (aim) => part(pose({ act: 'shoot', actT: 0.2, aim }), 'armF')[0].ch;
  assert.equal(arm(0), '-');
  assert.equal(arm(-Math.PI / 4), '/');
  assert.equal(arm(Math.PI / 4), '\\');
  assert.equal(arm(-Math.PI / 2), '|');
});

test('shoot: the flash only for actT < 0.06, at the gun muzzle; recoil at 0.02 and not at 0.2', () => {
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const flash = part(pose({ act: 'shoot', actT: 0.05, gun }), 'fx')[0];
    assert.equal(flash.ch, '*');
    assert.equal(flash.tone, 'fx');
    assert.ok(Math.abs(flash.dx - (SHOULDER.dx + MUZZLE_R[gun] - 0.3 * Math.max(0, 1 - (0.05 - 0.04) / 0.11))) < 1e-6);
    assert.equal(part(pose({ act: 'shoot', actT: 0.07, gun }), 'fx').length, 0);
  }
  const g0 = part(pose({ act: 'shoot', actT: 0.02 }), 'gun')[0].dx, g1 = part(pose({ act: 'shoot', actT: 0.2 }), 'gun')[0].dx;
  assert.ok(g0 < g1 - 0.25, 'recoil');
});

test('guns: each has its GUN_ART length along the ray; beyond 35° the glyphs become the arm glyph, but the sniper keeps °', () => {
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const g = part(pose({ act: 'shoot', actT: 0.2, gun }), 'gun');
    assert.equal(g.map((x) => x.ch).join(''), GUN_ART[gun].glyphs);
    const up = part(pose({ act: 'shoot', actT: 0.2, gun, aim: -Math.PI / 3 }), 'gun').map((x) => x.ch).join('');
    assert.equal(up, gun === 'sniper' ? '///°///' : '/'.repeat(GUN_ART[gun].glyphs.length));
  }
});

test('carried: idle, aim 0 and not aimed puts the gun level at the hip, pointing forward', () => {
  const g = part(pose({ gun: 'rifle' }), 'gun');
  assert.equal(g.map((x) => x.ch).join(''), '═╦╤══');
  assert.ok(g.every((x) => Math.abs(x.dy - 0.3) < 0.13), 'at the hip (breathing aside)');
  const hand = g[GUN_ART.rifle.hand];
  assert.ok(Math.abs(hand.dx - 0.45) < 1e-9);
  assert.ok(part(pose({ gun: 'rifle', aimed: true }), 'gun')[0].dy < 0, 'aimed: on the ray from the shoulder');
});

test('defaults: {x, y} alone is idle facing right; an unknown act is idle; bad numbers are clamped or zeroed', () => {
  const idle = pose({});
  assert.deepEqual(stickPose({ x: 10, y: 20 }, 0).map((g) => g.ch), idle.map((g) => g.ch));
  assert.deepEqual(pose({ act: 'dance' }), idle);
  assert.deepEqual(pose({ act: 'shoot', actT: -3, aim: 9 }), pose({ act: 'shoot', actT: 0, aim: Math.PI / 2 }));
});
