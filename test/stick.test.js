import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickPose, MIRROR, SHOULDER, MUZZLE_R, GUN_ART, HAND_R, createMotionMemory } from '../src/stick.js';

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

test('punch: the fist reaches dx ≥ 1.5 at actT 0.06 and 0.1, not at 0 or 0.3', () => {
  const reach = (actT) => Math.max(...pose({ act: 'punch', actT }).filter((g) => g.part === 'armF').map((g) => g.dx));
  assert.ok(reach(0.06) >= 1.5 && reach(0.1) >= 1.5);
  assert.ok(reach(0) < 1.5 && reach(0.3) < 1.5);
});

test('kick: the foot reaches dx ≥ 1.4 at dy ≈ 0.55 at actT 0.06 and 0.15, in the air too', () => {
  for (const ground of [true, false]) for (const actT of [0.06, 0.15]) {
    const foot = pose({ act: 'kick', actT, ground, vy: ground ? 0 : 5 }).filter((g) => g.part === 'legF' && g.dx >= 1.4);
    assert.ok(foot.some((g) => Math.abs(g.dy - 0.55) < 0.1), `ground ${ground} t ${actT}`);
  }
});

test('hurt: all white for actT < 0.08, none after; at 0.35 the locomotion pose', () => {
  assert.ok(pose({ act: 'hurt', actT: 0.05 }).every((g) => g.tone === 'flash'));
  assert.ok(pose({ act: 'hurt', actT: 0.1 }).every((g) => g.tone !== 'flash'));
  assert.deepEqual(pose({ act: 'hurt', actT: 0.35 }), pose({}));
  assert.ok(pose({ act: 'hurt', actT: 0.05 }, 0, { reducedMotion: true }).every((g) => g.tone !== 'flash'));
});

test('protection: a 0.35–0.8 pulse that changes over time; steady 0.5 with Reduce Motion', () => {
  const as = [0, 0.05, 0.1, 0.15].map((t) => head(pose({ safe: true }, t)).a);
  assert.ok(as.every((a) => a >= 0.35 - 1e-9 && a <= 0.8 + 1e-9));
  assert.ok(new Set(as.map((a) => a.toFixed(3))).size > 1);
  assert.equal(head(pose({ safe: true }, 0.1, { reducedMotion: true })).a, 0.5);
});

test('dead: pieces never go below the feet line, are still from 1.15 to 1.4, fade 1.4→2.0, then nothing', () => {
  for (let t = 0; t <= 2; t += 0.05) for (const g of pose({ act: 'dead', actT: t })) assert.ok(g.dy <= 1 + 1e-9, `${g.part} at ${t}`);
  const at = (t) => pose({ act: 'dead', actT: t }).filter((g) => g.part !== 'fx').map((g) => [g.part, g.dx.toFixed(6), g.dy.toFixed(6)]);
  assert.deepEqual(at(1.15), at(1.4));
  assert.ok(pose({ act: 'dead', actT: 1.35 }).every((g) => g.a === 1 || g.part === 'fx'));
  assert.ok(pose({ act: 'dead', actT: 1.99 }).every((g) => g.a < 0.05));
  assert.deepEqual(pose({ act: 'dead', actT: 2.01 }), []);
  assert.ok(pose({ act: 'dead', actT: 0.1 }, 0, { reducedMotion: true }).every((g) => g.ch === '_' || g.ch === 'O'));
});

test('respawn: invisible at spawnT 0; idle from 0.45', () => {
  assert.ok(pose({ spawnT: 0 }).every((g) => g.a === 0));
  assert.deepEqual(pose({ spawnT: 0.45 }), pose({}));
});

test('roll: the head goes top, front, bottom, back; no gun; nothing on the top row; mirrored facing left', () => {
  const headAt = (actT, facing = 1) => pose({ act: 'roll', actT, facing, gun: 'rifle' }).find((g) => g.part === 'head');
  assert.deepEqual([0.03, 0.1, 0.17, 0.25].map((t) => [headAt(t).dx, headAt(t).dy]), [[0, 0], [0.7, 1], [0, 1], [-0.7, 0]]);
  for (const t of [0.03, 0.1, 0.17, 0.25]) {
    const g = pose({ act: 'roll', actT: t, gun: 'sniper' });
    assert.equal(g.filter((x) => x.part === 'gun').length, 0);
    assert.ok(g.filter((x) => x.part !== 'fx').every((x) => x.dy >= 0));
  }
  assert.equal(headAt(0.1, -1).dx, -0.7);
});

test('motion memory: landing sets landT 0; dead → idle sets spawnT 0; ids are forgotten after 5 s', () => {
  const m = createMotionMemory();
  const s1 = m.fill('a', { ground: false, act: 'idle' }, 0);
  assert.equal(s1.spawnT, 0, 'first seen');
  assert.equal(s1.landT, Infinity);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 0.1).landT, 0);
  assert.ok(Math.abs(m.fill('a', { ground: true, act: 'idle' }, 0.2).landT - 0.1) < 1e-9);
  m.fill('a', { ground: true, act: 'dead' }, 1);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 3).spawnT, 0);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 9).spawnT, 0, 'forgotten after 5 s: seen fresh');
});

const ACT_STATES = [
  { act: 'punch', actT: 0.03 }, { act: 'punch', actT: 0.08, vx: 30, x: 14 }, { act: 'punch', actT: 0.2 },
  { act: 'kick', actT: 0.03 }, { act: 'kick', actT: 0.1, ground: false, vy: 20 }, { act: 'kick', actT: 0.3, aim: -0.6 },
  { act: 'hurt', actT: 0.05 }, { act: 'hurt', actT: 0.25, ground: false, vy: -20 },
  { act: 'roll', actT: 0.05 }, { act: 'roll', actT: 0.2 },
  { act: 'dead', actT: 0.04 }, { act: 'dead', actT: 0.5 }, { act: 'dead', actT: 1.6 },
  { spawnT: 0.2 }, { spawnT: 0.4 }, { safe: true, vx: 30, x: 14 },
];

test('actions: mirrored facing left, pure, and printable', () => {
  for (const s of ACT_STATES) {
    const r = pose({ ...s, facing: 1 }, 0.7), l = pose({ ...s, facing: -1, vx: -(s.vx || 0), x: s.x ? -s.x : 10 }, 0.7);
    assert.ok(r.length > 0, JSON.stringify(s));
    assert.deepEqual(l.map((g) => [g.part, +(-g.dx).toFixed(9), +g.dy.toFixed(9), MIRROR[g.ch] || g.ch, g.tone, g.a]),
      r.map((g) => [g.part, +g.dx.toFixed(9), +g.dy.toFixed(9), g.ch, g.tone, g.a]), JSON.stringify(s));
    for (const x of r) assert.match(x.ch, ASCII);
    const st = { ...base, ...s }, copy = structuredClone(st);
    assert.deepEqual(stickPose(st, 0.7), stickPose(st, 0.7));
    assert.deepEqual(st, copy);
  }
});

test('actions: punch, kick, hurt and roll stay inside the box and keep a head and a torso', () => {
  for (const s of ACT_STATES.filter((s) => s.act && s.act !== 'dead')) {
    const g = pose(s);
    assert.ok(head(g) && part(g, 'torso').length, JSON.stringify(s));
    for (const x of g.filter((x) => x.part !== 'gun' && x.part !== 'fx')) {
      assert.ok(Math.abs(x.dx) <= 2.5 && x.dy >= -1.6 && x.dy <= 1.2, `${x.part} ${x.ch} at ${x.dx},${x.dy} in ${JSON.stringify(s)}`);
    }
  }
});

test('punch keeps the running legs; kick keeps the head where locomotion put it', () => {
  const run = { vx: 30, x: 14 };
  assert.deepEqual(part(pose({ ...run, act: 'punch', actT: 0.1 }), 'legB'), part(pose(run), 'legB'));
  const rise = { ground: false, vy: -20 };
  assert.deepEqual(head(pose({ ...rise, act: 'kick', actT: 0.03 })), head(pose(rise)));
  assert.ok(Math.abs(head(pose({ ...rise, act: 'kick', actT: 0.1 })).dx - (head(pose(rise)).dx - 0.35)) < 1e-9);
});

test('dead: the pop is the hurt pose in white with 4 sparks; settled pieces lie as _ and O on the feet line', () => {
  const pop = pose({ act: 'dead', actT: 0.04 });
  assert.equal(part(pop, 'fx').filter((g) => g.ch === '*').length, 4);
  assert.ok(pop.filter((g) => g.part !== 'fx').every((g) => g.tone === 'flash'));
  assert.equal(part(pose({ act: 'dead', actT: 0.3 }), 'fx').length, 0);
  const rest = pose({ act: 'dead', actT: 1.2 });
  assert.equal(rest.length, 6);
  assert.ok(rest.every((g) => g.dy === 1 && (g.part === 'head' ? g.ch === 'O' : g.ch === '_')));
  assert.equal(part(pose({ act: 'dead', actT: 0.04 }, 0, { reducedMotion: true }), 'fx').length, 0);
});

test('respawn: flies in, then white; Reduce Motion fades in place with no white', () => {
  const mid = pose({ spawnT: 0.1 });
  assert.ok(head(mid).dy < head(pose({})).dy - 0.1, 'the head comes in from above');
  assert.ok(pose({ spawnT: 0.4 }).every((g) => g.tone === 'flash' && g.a === 1));
  const rm = pose({ spawnT: 0.15 }, 0, { reducedMotion: true });
  assert.deepEqual(rm.map((g) => [g.ch, g.dx, g.dy]), pose({}, 0, { reducedMotion: true }).map((g) => [g.ch, g.dx, g.dy]));
  assert.ok(rm.every((g) => Math.abs(g.a - 0.5) < 1e-9 && g.tone === 'body'));
  assert.ok(pose({ spawnT: 0.4 }, 0, { reducedMotion: true }).every((g) => g.tone === 'body' && g.a === 1));
});

test('roll: the puff trails behind while actT < 0.1, not with Reduce Motion', () => {
  const puff = part(pose({ act: 'roll', actT: 0.05 }), 'fx');
  assert.equal(puff.length, 1);
  assert.equal(puff[0].ch, '~');
  assert.ok(Math.abs(puff[0].dx + 2.4) < 1e-9 && puff[0].dy === 1);
  assert.equal(part(pose({ act: 'roll', actT: 0.12 }), 'fx').length, 0);
  assert.equal(part(pose({ act: 'roll', actT: 0.05 }, 0, { reducedMotion: true }), 'fx').length, 0);
});
