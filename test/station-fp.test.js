import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FP, fpInput, look, lookPoint, createLook } from '../src/rpg/firstperson.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg}: ${a} vs ${b}`);

test('the keys walk where you look: W forward, S back, A and D sideways', () => {
  // Facing south (+z, yaw 0): forward is +z, and your right hand is west (−x).
  let m = fpInput({ x: 0, y: -1, run: true }, 0);
  near(m.x, 0, 'W x'); near(m.y, 1, 'W south'); assert.equal(m.run, true);
  m = fpInput({ x: 1, y: 0 }, 0);
  near(m.x, -1, 'D west'); near(m.y, 0, 'D z');
  // Facing east (+x, yaw π/2): W goes east, D goes south.
  m = fpInput({ x: 0, y: -1 }, Math.PI / 2);
  near(m.x, 1, 'W east'); near(m.y, 0, 'W z');
  m = fpInput({ x: 1, y: 0 }, Math.PI / 2);
  near(m.x, 0, 'D x'); near(m.y, 1, 'D south');
  m = fpInput({ x: 0, y: 1 }, Math.PI / 2);
  near(m.x, -1, 'S back west');
  assert.deepEqual(fpInput({ x: 0, y: 0 }, 1), { x: 0, y: 0, run: false });
});

test('the mouse turns you: right turns right, up looks up, never past straight up or down', () => {
  const l = createLook(0);
  look(l, 100, 0); // right, facing south: toward the west
  assert.ok(l.yaw < 0, 'yaw went toward −x');
  const p = lookPoint({ x: 0, y: 0, z: 0 }, l);
  assert.ok(p.x < 0 && p.z > 0, 'looking south-west');
  look(l, 0, -100); // the mouse up
  assert.ok(l.pitch > 0, 'looks up');
  look(l, 0, -1e6);
  near(l.pitch, FP.pitchMax, 'up to the limit');
  look(l, 0, 1e6);
  near(l.pitch, -FP.pitchMax, 'down to the limit');
  const q = lookPoint({ x: 1, y: 2, z: 3 }, { yaw: 0, pitch: 0 });
  assert.deepEqual(q, { x: 1, y: 2, z: 4 });
});
