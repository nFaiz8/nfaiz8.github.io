import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poseFigure, turnToward, BONES, HEAD, U } from '../src/rpg/rig.js';
import { RIG } from '../src/stick.js';

const TAU = 2 * Math.PI;
const PHASES = Array.from({ length: 33 }, (_, i) => (i * Math.PI) / 16);
const GAITS = [0, 1, 1.6];
const YAWS = [0, 0.7, Math.PI / 2, -2.4, Math.PI];
const JOINTS = ['hip', 'neck', 'head', 'shoulder', 'elbowL', 'handL', 'elbowR', 'handR', 'kneeL', 'footL', 'kneeR', 'footR', 'lantern'];
const pose = (s) => poseFigure({ yaw: 0, phase: 0, gait: 0, t: 0, reducedMotion: true, ...s });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
const fwd = (yaw) => ({ x: Math.sin(yaw), z: Math.cos(yaw) });
const along = (p, yaw) => p.x * Math.sin(yaw) + p.z * Math.cos(yaw);
// How far p sits ahead of the line a→b, along the facing direction.
const ahead = (p, a, b, yaw) => {
  const d = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, l2 = d.x ** 2 + d.y ** 2 + d.z ** 2;
  const k = ((p.x - a.x) * d.x + (p.y - a.y) * d.y + (p.z - a.z) * d.z) / l2;
  return along({ x: p.x - (a.x + k * d.x), z: p.z - (a.z + k * d.z) }, yaw);
};

test('shares the arena\'s proportions, scaled to the station', () => {
  assert.ok(Math.abs(BONES.torso - RIG.torso * U) < 1e-12);
  assert.ok(Math.abs(BONES.thigh - RIG.thigh * U) < 1e-12);
  assert.ok(Math.abs(BONES.foreArm - RIG.foreArm * U) < 1e-12);
});

test('keeps every bone its length at any phase, gait and yaw', () => {
  for (const yaw of YAWS) for (const gait of GAITS) for (const phase of PHASES) {
    const j = pose({ yaw, gait, phase });
    const bones = [
      ['hip', 'neck', BONES.torso],
      ['shoulder', 'elbowL', BONES.upperArm], ['elbowL', 'handL', BONES.foreArm],
      ['shoulder', 'elbowR', BONES.upperArm], ['elbowR', 'handR', BONES.foreArm],
      ['hip', 'kneeL', BONES.thigh], ['kneeL', 'footL', BONES.shin],
      ['hip', 'kneeR', BONES.thigh], ['kneeR', 'footR', BONES.shin],
    ];
    for (const [a, b, len] of bones) {
      assert.ok(Math.abs(dist(j[a], j[b]) - len) < 1e-6, `${a}→${b} at yaw ${yaw} gait ${gait} phase ${phase}: ${dist(j[a], j[b])} vs ${len}`);
    }
  }
});

test('stands about 1.6 tall', () => {
  const j = pose({});
  const h = j.head.y + HEAD.r - Math.min(j.footL.y, j.footR.y);
  assert.ok(h >= 1.5 && h <= 1.7, `height ${h}`);
});

test('the feet never go through the floor, and a planted foot is on it', () => {
  for (const gait of GAITS) for (let i = 0; i <= 128; i++) {
    const j = pose({ gait, phase: (i * TAU) / 128 });
    assert.ok(j.footL.y >= -1e-9 && j.footR.y >= -1e-9, `gait ${gait} phase ${i}`);
  }
  for (const gait of [1, 1.6]) {
    let back = null;
    for (let i = 0; i < 256; i++) {
      const j = pose({ gait, phase: (i * TAU) / 256 });
      if (!back || j.footL.z < back.footL.z) back = j;
    }
    assert.ok(back.footL.y < 0.01, `gait ${gait}: the back foot is ${back.footL.y} up`);
  }
});

test('faces along yaw: 0 is south (+z), π/2 east (+x), and turning is a rotation about y', () => {
  const a0 = pose({ gait: 1, phase: -0.3 }), b0 = pose({ gait: 1, phase: 0.3 });
  assert.ok(b0.footL.z > a0.footL.z + 0.05, 'swinging foot moves +z at yaw 0');
  const a1 = pose({ yaw: Math.PI / 2, gait: 1, phase: -0.3 }), b1 = pose({ yaw: Math.PI / 2, gait: 1, phase: 0.3 });
  assert.ok(b1.footL.x > a1.footL.x + 0.05, 'swinging foot moves +x at yaw π/2');
  for (const yaw of YAWS) for (const gait of GAITS) for (const phase of [0, 1.1, 2.5, 4]) {
    const z = pose({ gait, phase }), r = pose({ yaw, gait, phase });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const k of JOINTS) {
      const x = z[k].x * c + z[k].z * s, zz = -z[k].x * s + z[k].z * c;
      assert.ok(Math.abs(r[k].x - x) < 1e-9 && Math.abs(r[k].y - z[k].y) < 1e-9 && Math.abs(r[k].z - zz) < 1e-9, `${k} at yaw ${yaw}`);
    }
  }
});

test('knees bend forward and elbows back', () => {
  for (const yaw of [0, 1.2]) for (const gait of [0, 1, 1.6]) for (const phase of PHASES) {
    const j = pose({ yaw, gait, phase });
    assert.ok(ahead(j.kneeL, j.hip, j.footL, yaw) > 0, `left knee, gait ${gait} phase ${phase}`);
    assert.ok(ahead(j.kneeR, j.hip, j.footR, yaw) > 0, `right knee, gait ${gait} phase ${phase}`);
    assert.ok(ahead(j.elbowL, j.shoulder, j.handL, yaw) < 0, `left elbow, gait ${gait} phase ${phase}`);
    assert.ok(ahead(j.elbowR, j.shoulder, j.handR, yaw) < 0, `right elbow, gait ${gait} phase ${phase}`);
  }
});

test('the arms counter-swing to the legs', () => {
  for (const gait of [1, 1.6]) {
    const j = pose({ yaw: 0.4, gait, phase: Math.PI / 2 });
    assert.ok(along(j.footL, 0.4) > along(j.footR, 0.4), 'the left foot is forward');
    assert.ok(along(j.handL, 0.4) < along(j.handR, 0.4), 'so the left hand is behind the right');
  }
});

test('standing is symmetric about the facing plane (but the lantern hand), whatever the phase', () => {
  const j = pose({ gait: 0, phase: 0 });
  const m = (p) => ({ x: -p.x, y: p.y, z: p.z });
  for (const [a, b] of [['footL', 'footR'], ['kneeL', 'kneeR']]) assert.ok(dist(j[a], m(j[b])) < 1e-9, `${a} mirrors ${b}`);
  for (const k of ['hip', 'neck', 'head', 'shoulder']) assert.ok(Math.abs(j[k].x) < 1e-9, `${k} on the plane`);
  for (const phase of [1, 2.2, 5, 77]) {
    const p = pose({ gait: 0, phase });
    for (const k of JOINTS) assert.ok(dist(j[k], p[k]) < 1e-9, `${k} moved with phase ${phase}`);
  }
});

test('turnToward goes the short way, converges and never overshoots', () => {
  const wrap = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
  let y = 3;
  const target = -3;
  const step = turnToward(y, target, 1 / 60);
  assert.ok(wrap(step - y) > 0, 'across ±π, not back through 0');
  let d0 = Math.abs(wrap(target - y));
  for (let i = 0; i < 120; i++) {
    y = turnToward(y, target, 1 / 60);
    const d = wrap(target - y);
    assert.ok(d >= -1e-12, 'no overshoot');
    assert.ok(Math.abs(d) <= d0 + 1e-12);
    d0 = Math.abs(d);
  }
  assert.ok(d0 < 1e-3, `left ${d0}`);
  assert.ok(Math.abs(wrap(turnToward(0, 2, 10) - 2)) < 1e-9, 'a long frame lands on it');
  assert.equal(turnToward(1, 1, 1 / 60), 1);
});

test('every value is finite for wild inputs', () => {
  for (const s of [{ phase: 1e9 }, { gait: 0, phase: -1e7 }, { gait: 2, phase: 3 }, { yaw: 1000, gait: 1 }, { gait: 50, t: 1e6, reducedMotion: false }]) {
    const j = poseFigure({ yaw: 0, phase: 0, gait: 0, t: 12.3, reducedMotion: false, ...s });
    for (const k of JOINTS) for (const c of ['x', 'y', 'z']) assert.ok(Number.isFinite(j[k][c]), `${k}.${c} for ${JSON.stringify(s)}`);
  }
  assert.ok(Number.isFinite(turnToward(1e6, -1e6, 0.016)));
});

test('a commuter can stand on one foot more (shift), and hold a phone up before them', () => {
  const still = pose({}), left = pose({ shift: 1 }), right = pose({ shift: -1 });
  assert.ok(left.hip.x > still.hip.x + 0.02 && right.hip.x < still.hip.x - 0.02, 'the hip moves over a foot');
  assert.ok(Math.abs(left.footL.x - still.footL.x) < 1e-9, 'the feet stay put');
  for (const k of JOINTS) assert.ok(Number.isFinite(left[k].x + left[k].y + left[k].z), k);
  const phone = pose({ phone: true });
  assert.ok(phone.handR.y > still.handR.y + 0.15, 'the hand comes up');
  assert.ok(phone.handR.z > still.handR.z, 'in front');
  assert.ok(Math.abs(phone.handR.x - phone.neck.x) < 0.15, 'before the body');
  assert.ok(phone.lantern.y > phone.handR.y, 'the screen just above the hand');
  // Bones keep their lengths.
  assert.ok(Math.abs(dist(phone.shoulder, phone.elbowR) - BONES.upperArm) < 1e-6);
  assert.ok(Math.abs(dist(phone.elbowR, phone.handR) - BONES.foreArm) < 1e-6);
});
