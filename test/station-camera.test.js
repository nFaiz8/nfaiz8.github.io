import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAM, tilesAcross, fovFor, createCamera, followCamera, eyeFor } from '../src/rpg/camera.js';

const MAP = { cols: 48, rows: 19 };

test('35 degrees down, 10 back, never rotating', () => {
  assert.ok(Math.abs(CAM.pitch - (35 * Math.PI) / 180) < 1e-12);
  const cam = createCamera({ x: 20, y: -3, z: 9 });
  assert.deepEqual(cam, { x: 20, y: -2, z: 9 });
  const eye = eyeFor(cam);
  assert.ok(Math.abs(eye.x - cam.x) < 1e-12, 'straight behind: no yaw');
  assert.ok(Math.abs(Math.hypot(eye.y - cam.y, eye.z - cam.z) - CAM.dist) < 1e-9);
  assert.ok(Math.abs(Math.atan2(eye.y - cam.y, eye.z - cam.z) - CAM.pitch) < 1e-9);
});

test('12 tiles across on a wide screen, 8 on a phone held upright', () => {
  assert.equal(tilesAcross(16 / 9), 12);
  assert.equal(tilesAcross(9 / 16), 8);
  for (const aspect of [16 / 9, 9 / 16]) {
    const halfW = Math.tan(((fovFor(aspect) / 2) * Math.PI) / 180) * CAM.dist * aspect;
    assert.ok(Math.abs(halfW * 2 - tilesAcross(aspect)) < 1e-9, `aspect ${aspect}`);
  }
});

test('follows on a 0.15 s spring', () => {
  const cam = createCamera({ x: 20, y: 0, z: 9 });
  followCamera(cam, { x: 21, y: 0, z: 9 }, CAM.spring, MAP, 16 / 9);
  assert.ok(Math.abs(cam.x - (20 + (1 - Math.exp(-1)))) < 1e-9);
  followCamera(cam, { x: 21, y: 0, z: 9 }, 0, MAP, 16 / 9);
  assert.ok(Math.abs(cam.x - (20 + (1 - Math.exp(-1)))) < 1e-9, 'dt 0 holds still');
});

test('kept inside the map', () => {
  // 16:9 on 48 × 19: hd = 6 / (16/9) = 3.375, so z runs from 0.84375 to 19 - 1.6875 = 17.3125.
  const near = createCamera({ x: 0, y: 0, z: 0 });
  followCamera(near, { x: 0, y: 0, z: 0 }, 1, MAP, 16 / 9);
  assert.ok(Math.abs(near.x - 6) < 1e-9, `x ${near.x}`);
  assert.ok(Math.abs(near.z - 0.84375) < 1e-9, `z ${near.z}`);
  const far = createCamera({ x: 48, y: 0, z: 19 });
  followCamera(far, { x: 48, y: 0, z: 19 }, 1, MAP, 16 / 9);
  assert.ok(Math.abs(far.x - 42) < 1e-9, `x ${far.x}`);
  assert.ok(Math.abs(far.z - 17.3125) < 1e-9, `z ${far.z}`);
  const narrow = createCamera({ x: 0, y: 0, z: 0 });
  followCamera(narrow, { x: 0, y: 0, z: 0 }, 1, { cols: 6, rows: 4 }, 16 / 9);
  assert.equal(narrow.x, 3, 'a map narrower than the view is centred');
});
