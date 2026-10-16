// You in the station, as the arena's stick figure rigged in 3D (task 8b): the same bones as src/stick.js,
// posed as a real skeleton that turns, strides in depth, swings its arms and carries the lantern.
// Pure: no three.js, no DOM. figure.js draws it.
//
// Space: x east, y up, z south, relative to the point between your feet. yaw is in radians: 0 faces south
// (+z, toward the camera) and positive yaw turns toward +x, so forward is (sin yaw, 0, cos yaw). Your left
// is (cos yaw, 0, −sin yaw): facing the camera, your left hand is on screen-right. Nothing is ever
// mirrored; facing comes from yaw alone.
import { RIG } from '../stick.js';
import { SPRINT } from './move.js';
import { clamp } from './camera.js';

const TAU = 2 * Math.PI;
// The arena's figure in u (stick.js): the hip 1 below the body's centre, the feet 2.9, the head's centre
// HEAD_D above the neck, and the O about a row (2 u) tall... its ink is about 1 u.
const FEET_U = 2.9, HIP_U = 1, HEAD_D = 0.55, HEAD_R = 0.5;
const HIP_H = FEET_U - HIP_U; // the hip above the feet, standing
// u → world units, so you stand 1.6 tall from your feet to the top of your head.
export const U = 1.6 / (HIP_H + RIG.torso + HEAD_D + HEAD_R);
export const BONES = { torso: RIG.torso * U, upperArm: RIG.upperArm * U, foreArm: RIG.foreArm * U, thigh: RIG.thigh * U, shin: RIG.shin * U };
export const HEAD = { d: HEAD_D * U, r: HEAD_R * U };
const NECK_TO_S = 0.4 * U; // the shoulder below the neck (stick.js: SHOULDER sits 0.4 u under it)

// The walk. One cycle is one stride: a step with each foot. A planted foot slides back linearly over half the
// cycle while you cover half a stride, so it goes from +C/4 to −C/4: half-stride A = C/4 keeps it still on the
// floor (no skating). C is as long as the legs reach with the hip dropped (A ≈ 0.28 of a 0.65 leg).
const STRIDE = 1.1, RUN_STRIDE = 1.3;
export const strideFor = (gait) => STRIDE + (RUN_STRIDE - STRIDE) * runK(gait);
// Advance the walk cycle by the ground covered, so the stride always matches it.
export const advancePhase = (phase, walked, gait) => mod(phase + (TAU * walked) / strideFor(gait), TAU);

const WALK = { lift: 0.09, runLift: 0.05, drop: 0.035, runDrop: 0.03, bob: 0.015, sway: 0.02, lean: 0.1, runLean: 0.12 };
const FEET_W = { idle: 0.3 * U, walk: 0.28 * U }; // each foot out from the middle
// Hands from the shoulder, in u: [out, down, forward]. Idle: hanging, the lantern held a little forward.
const HAND_L = { idle: [0.45, 1.72, -0.3], walk: [0.35, 1.7, -0.1], swing: 0.6, raise: 0.25 };
const HAND_R = { idle: [0.45, 1.2, 0.6], walk: [0.45, 1.15, 0.6], swing: 0.22 };
const RUN_SWING = 0.5; // the arms swing this much more when you run
const BREATH = { period: 2.4, h: 0.012 }; // the arena's breath: a slow, tiny rise
const LANTERN = { below: 0.075, sway: 0.015, swing: 0.03 };
const REACH = 0.999; // a target out of reach is pulled in to this much of the limb (as stick.js)
const TURN = 0.08; // the facing spring, seconds

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const mod = (v, m) => v - m * Math.floor(v / m);
const lerp = (a, b, k) => a + (b - a) * k;
const runK = (gait) => clamp((fin(gait, 0) - 1) / (SPRINT - 1), 0, 1);
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

// Turn the short way round toward targetYaw, on a spring: quick, never instant, never past it.
export function turnToward(yaw, targetYaw, dt) {
  yaw = wrapAngle(fin(yaw, 0));
  const d = wrapAngle(fin(targetYaw, yaw) - yaw), k = dt > 0 ? 1 - Math.exp(-dt / TURN) : 0;
  return wrapAngle(yaw + d * k);
}

// A foot's place along the stride: swinging forward on a sine (eased at both ends), planted and sliding back
// linearly (so it doesn't skate). p in [0, 2π): swinging while cos p > 0.
function strideAt(p, a) {
  if (p < Math.PI / 2 || p > 1.5 * Math.PI) return a * Math.sin(p);
  return a * (1 - (2 * (p - Math.PI / 2)) / Math.PI);
}

// Local space while posing: x = your left, y = up, z = forward. Turned to world space at the end.
const v = (x = 0, y = 0, z = 0) => ({ x, y, z });
const S = { hip: v(), neck: v(), shoulder: v(), tL: v(), tR: v(), fL: v(), fR: v(), m: v(), p: v() };
const set = (o, x, y, z) => { o.x = x; o.y = y; o.z = z; return o; };

// Two-bone IK: from root toward target, bones a then b, the middle joint bent toward pole. Writes the middle
// joint and the reached end (the target, or pulled in toward the root when it's out of reach).
function twoBone(root, target, a, b, pole, mid, end) {
  let dx = target.x - root.x, dy = target.y - root.y, dz = target.z - root.z;
  let d = Math.hypot(dx, dy, dz);
  if (d < 1e-9) { dx = 0; dy = -1; dz = 0; d = 1e-9; }
  const nx = dx / d, ny = dy / d, nz = dz / d;
  d = clamp(d, Math.abs(a - b) + 1e-6, REACH * (a + b));
  // The bend direction: the pole, less its part along the limb.
  const pn = pole.x * nx + pole.y * ny + pole.z * nz;
  let mx = pole.x - pn * nx, my = pole.y - pn * ny, mz = pole.z - pn * nz;
  let ml = Math.hypot(mx, my, mz);
  if (ml < 1e-9) { mx = -ny * nx; my = 1 - ny * ny; mz = -ny * nz; ml = Math.hypot(mx, my, mz) || 1; }
  mx /= ml; my /= ml; mz /= ml;
  const along = (a * a - b * b + d * d) / (2 * d), h = Math.sqrt(Math.max(0, a * a - along * along));
  set(mid, root.x + nx * along + mx * h, root.y + ny * along + my * h, root.z + nz * along + mz * h);
  set(end, root.x + nx * d, root.y + ny * d, root.z + nz * d);
}

const KNEE_POLE = v(0, 0, 1);
const ELBOW_POLE_L = v(0.6, 0, -1), ELBOW_POLE_R = v(-0.6, 0, -1); // back, and a little out
const JOINTS = ['hip', 'neck', 'head', 'shoulder', 'elbowL', 'handL', 'elbowR', 'handR', 'kneeL', 'footL', 'kneeR', 'footR', 'lantern'];

// state = { yaw, phase, gait, t, reducedMotion }; out gets each joint as { x, y, z } in world units, relative
// to the feet point. gait: 0 standing, 1 walking, SPRINT running (a smoothed speed / walking speed).
export function poseFigure(state, out = {}) {
  for (const k of JOINTS) out[k] ??= v();
  const yaw = fin(state.yaw, 0), rm = !!state.reducedMotion, t = fin(state.t, 0);
  const gait = clamp(fin(state.gait, 0), 0, SPRINT), g = Math.min(1, gait), r = runK(gait);
  const p = mod(fin(state.phase, 0), TAU), q = mod(p + Math.PI, TAU);
  const a = strideFor(gait) / 4; // the half-stride (see STRIDE)

  // The hip drops into the walk, bobs (lowest when the feet are furthest apart) and sways over the planted foot.
  const breath = rm ? 0 : BREATH.h * Math.sin((TAU * t) / BREATH.period);
  const hipY = HIP_H * U - g * WALK.drop - r * WALK.runDrop + g * WALK.bob * (1 + r) * Math.cos(2 * p) + breath;
  const hip = set(S.hip, -g * WALK.sway * Math.cos(p), hipY, 0);
  const lean = g * WALK.lean + r * WALK.runLean;
  const ux = 0, uy = Math.cos(lean), uz = Math.sin(lean); // up the torso
  const neck = set(S.neck, hip.x + ux * BONES.torso, hip.y + uy * BONES.torso, hip.z + uz * BONES.torso);
  const sh = set(S.shoulder, neck.x - ux * NECK_TO_S, neck.y - uy * NECK_TO_S, neck.z - uz * NECK_TO_S);
  set(out.head, neck.x + ux * HEAD.d, neck.y + uy * HEAD.d, neck.z + uz * HEAD.d);

  // Feet: idle apart and flat, blended into the stride.
  const fw = lerp(FEET_W.idle, FEET_W.walk, g), lift = g * WALK.lift + r * WALK.runLift;
  set(S.fL, fw, lift * Math.max(0, Math.cos(p)), g * strideAt(p, a));
  set(S.fR, -fw, lift * Math.max(0, Math.cos(q)), g * strideAt(q, a));
  twoBone(hip, S.fL, BONES.thigh, BONES.shin, KNEE_POLE, out.kneeL, out.footL);
  twoBone(hip, S.fR, BONES.thigh, BONES.shin, KNEE_POLE, out.kneeR, out.footR);

  // Hands counter-swing to the feet: the left hand is back when the left foot is forward. The right carries
  // the lantern, so it swings less and stays forward and out.
  const sw = g * (1 + RUN_SWING * r), s = Math.sin(p);
  const hl = (i) => lerp(HAND_L.idle[i], HAND_L.walk[i], g) * U;
  const hr = (i) => lerp(HAND_R.idle[i], HAND_R.walk[i], g) * U;
  set(S.tL, sh.x + hl(0), sh.y - hl(1) + sw * HAND_L.raise * U * Math.max(0, -s), sh.z + hl(2) - sw * HAND_L.swing * U * s);
  set(S.tR, sh.x - hr(0), sh.y - hr(1), sh.z + hr(2) + sw * HAND_R.swing * U * s);
  twoBone(sh, S.tL, BONES.upperArm, BONES.foreArm, ELBOW_POLE_L, out.elbowL, out.handL);
  twoBone(sh, S.tR, BONES.upperArm, BONES.foreArm, ELBOW_POLE_R, out.elbowR, out.handR);

  // The lantern hangs just below the right hand, swaying a little and lagging the arm's swing.
  const sway = rm ? 0 : LANTERN.sway * Math.sin(t * 1.9) + LANTERN.swing * g * Math.sin(p - 0.6);
  set(out.lantern, out.handR.x, out.handR.y - LANTERN.below, out.handR.z + sway);

  set(out.hip, hip.x, hip.y, hip.z);
  set(out.neck, neck.x, neck.y, neck.z);
  set(out.shoulder, sh.x, sh.y, sh.z);
  // To world space: a turn of yaw about y.
  const c = Math.cos(yaw), sn = Math.sin(yaw);
  for (const k of JOINTS) { const j = out[k], x = j.x; j.x = x * c + j.z * sn; j.z = -x * sn + j.z * c; }
  return out;
}
