// The arena's stick figures: a jointed rig of glyph sprites, and the gun constants the rules share.
// Pure: no DOM, no randomness. The rig: docs/specs/2026-10-14-arena-stickman-rig.md.

export const SHOULDER = { dx: 0.15, dy: -0.3 };
export const HAND_R = 1.3;
export const MUZZLE_R = { deagle: 2.8, rifle: 4.8, sniper: 6.8 };
// hand is the index of the glyph at the hand.
export const GUN_ART = {
  deagle: { glyphs: '╦═', hand: 0 },
  rifle: { glyphs: '═╦╤══', hand: 1 },
  sniper: { glyphs: '═╦═°═══', hand: 1 },
};

// The skeleton, in screen units u (1 u = a cell width, a row = 2 u). bar: how tall a `|` drawn at len 1 is,
// so a bone of length L is drawn with len L / bar (Menlo bold's bar is 1.50–1.56 u, not the full row).
export const RIG = { torso: 2, upperArm: 0.95, foreArm: 0.95, thigh: 1, shin: 1, bar: 1.5 };
const REACH = 0.999; // a target out of reach is pulled in to this much of the limb's full length
const S_X = SHOULDER.dx, S_Y = 2 * SHOULDER.dy; // the shoulder standing, in u
const NECK_TO_S = S_Y + RIG.torso - 1; // the shoulder sits this far below the neck (hip at +1)
const HEAD_D = 0.55; // the head's centre above the neck, along the torso: the O sits on the neck
const FEET = 2.9; // the feet line, in u below the body's centre
const CARRY = (20 * Math.PI) / 180; // a carried gun points this far below level

// Poses, facing right, in u from the body's centre: the hip (hx, hy), the torso's lean (radians from
// upright, + forward) and its stretch st (the breath), an extra head offset (hdx, hdy), the hands (bx, by
// back, fx, fy front) given where they'd be with the shoulder standing (they move with the shoulder), the
// feet (lbx, lby back, lfx, lfy front) where they are, and the carried gun's angle ga (+ down).
const FIELDS = ['hx', 'hy', 'lean', 'st', 'hdx', 'hdy', 'bx', 'by', 'fx', 'fy', 'lbx', 'lby', 'lfx', 'lfy', 'ga'];
const UPPER = ['lean', 'hdx', 'hdy', 'bx', 'by', 'fx', 'fy', 'ga'];
const pose = (o) => ({ hx: 0, hy: 1, lean: 0, st: 0, hdx: 0, hdy: 0, ga: CARRY, ...o });

const IDLE = pose({ bx: -0.45, by: 0.45, fx: 0.65, fy: -0.3, lbx: -0.55, lby: FEET, lfx: 0.55, lfy: FEET });
// The air: rise (one knee tucked, arms up), apex (arms out), fall (legs spread to brace, arms up and out).
const RISE = pose({ lean: 0.08, bx: -0.5, by: -2.9, fx: 0.75, fy: -0.6, lbx: -0.35, lby: 2.75, lfx: 0.5, lfy: 1.6 });
const APEX = pose({ bx: -1.6, by: -1.1, fx: 0.8, fy: -0.3, lbx: -0.35, lby: 2.6, lfx: 0.55, lfy: 2.2 });
const FALL = pose({ lean: -0.05, bx: -1.2, by: -2.3, fx: 0.85, fy: -0.5, lbx: -0.8, lby: 2.75, lfx: 0.8, lfy: 2.75 });
// Punch: the wind-up cocks the fist at the chest; the strike throws it out at shoulder height.
const PUNCH_WIND = pose({ lean: -0.12, bx: 0.35, by: 0, fx: 0.3, fy: -0.75, ga: -0.15 });
const PUNCH_STRIKE = pose({ lean: 0.25, bx: 0.2, by: 0.05, fx: 1.75, fy: S_Y, ga: 0 });
// Kick: the wind-up chambers the front knee; the strike drives the foot out and leans back.
const KICK_WIND = pose({ hx: -0.05, lean: -0.1, bx: -1.3, by: -1.0, fx: 1.0, fy: -0.7, lbx: -0.3, lby: FEET, lfx: 0.4, lfy: 1.2 });
const KICK_STRIKE = pose({ hx: -0.2, hy: 1.05, lean: -0.35, bx: -1.4, by: -0.3, fx: 0.7, fy: -0.6, lbx: -0.35, lby: FEET, lfx: 1.9, lfy: 1.1 });
const KICK_AIR_BACK = { lbx: -0.6, lby: 1.9 }; // a flying kick tucks the back knee
// Hurt: the torso snaps back, the head goes back, the arms flail.
const HURT = pose({ hx: -0.25, hy: 1.15, lean: -0.35, hdx: -0.15, hdy: 0.05, bx: -1.1, by: 0.2, fx: 0.6, fy: -0.9, lbx: -0.5, lby: FEET, lfx: 0.45, lfy: FEET, ga: -0.5 });
// Roll: tucked into a ball around the pivot, which then turns once. The spine curls (st < 0), the head
// tucks down past the neck, the knees come up to the chest and the hands hold the shins.
const TUCK = pose({ hx: -0.7, hy: 2.1, lean: 0.76, st: -0.4, hdx: 0.12, hdy: 0.85, bx: 0.1, by: 0.25, fx: 0.22, fy: 0.2, lbx: -0.2, lby: 2.65, lfx: -0.05, lfy: 2.6, ga: 0 });
const PIVOT_Y = 1.6; // the ball's centre, so it rolls on the floor (rig addendum said a row above the feet)
// The double jump's flip (headshots and double jump addendum §2): tucked round the body centre, the knees
// up to the chest and the hands on the shins. Its lean is the air pose's own, so the torso turns only with
// the rig. FLIP: how long the whole flip lasts, the tuck's way in, the untuck at its end, and with Reduce
// Motion the tuck's length (no turn). PUFF2: the two ~ of the air jump: how long, how far they spread.
const FLIP_TUCK = pose({ hx: -0.1, hy: 1.05, st: -0.4, hdx: 0.15, hdy: 0.25, bx: 0.4, by: 0.3, fx: 0.55, fy: 0.25, lbx: 0.15, lby: 1.25, lfx: 0.3, lfy: 1.2, ga: 0.5 });
const FLIP = { time: 0.36, in: 0.05, out: 0.08, rm: 0.2, rmIn: 0.04, rmOut: 0.06 };
const PUFF2 = { time: 0.15, r0: 0.5, r1: 2 };
const G_ROWS = 133; // arena.js's GRAVITY (rows/s²), which stick.js may not import: the puff stays where the jump was

// Timings and sizes (stickman spec §4 "Animation timing", rig addendum §4).
const BREATH_PERIOD = 2.4, BREATH_U = 0.12;
const STRIDE = 12, RUN_VX = 1.5, RUN_FULL = 8, SPRINT_VX0 = 30, SPRINT_VX1 = 45;
const RUN = { lean: 0.18, sprint: 0.26, drop: 0.3, bob: 0.24, step: 1.1, lift: 0.7, swing: 0.6, bx: -0.15, by: 0.15, raise: 0.3, pump: 0.08 };
const AIR_VY = 14;
const LAND_T = 0.12, LAND_DROP = 0.5, LAND_FEET = 0.7;
const RECOIL = 0.3, RECOIL_LEAN = 0.06, FLASH_T = 0.06;
const HURT_FLASH = 0.08;
const WHOOSH_T0 = 0.06, WHOOSH_T1 = 0.11, WHOOSH_D = 0.6;
const PUFF_T = 0.1, PUFF_V = 48;

// Death (stickman spec §4 "Death"; rig addendum §4): the pieces fly from the hurt pose, spin, bounce once
// and lie flat on the feet line.
const POP_T = 0.08, SPARK_T = 0.25, SPARK_R0 = 0.5, SPARK_R1 = 1.5;
const GRAV = 50, BOUNCE = 0.3, SPIN = 10, FADE_T = 1.4, DEAD_END = 2.0;
const REST_BONE = FEET / 2, REST_HEAD = (3 - 0.5) / 2; // rows: a bar lies on the feet line, the O sits on it
const SCATTER_V = { head: [-7, -14], torso: [-3, -9], armB: [-10, -11], armF: [4, -12], legB: [-5, -6], legF: [3, -7] };
const SPARK_D = Math.SQRT1_2, SIGNS = [-1, 1];

// Respawn and protection (stickman spec §4 "Respawn", §3 `safe`, §5 "Reduce Motion").
const SPAWN_FLY = 0.35, SPAWN_END = 0.45, SPAWN_R = 3, SPAWN_RM = 0.3;
const SAFE_MID = 0.575, SAFE_AMP = 0.225, SAFE_HZ = 3, SAFE_RM = 0.5;

const ACTS = { idle: true, shoot: true, punch: true, kick: true, hurt: true, dead: true, roll: true };

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const frac = (v) => v - Math.floor(v);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (v) => { const k = clamp01(v); return k * k * (3 - 2 * k); };

// Scratch poses, reused: L is locomotion, A an act's target, P what is drawn, Q the flip's target.
const L = pose({}), A = pose({}), P = pose({}), Q = pose({});
function copy(dst, src) { for (const k of FIELDS) dst[k] = src[k]; }
// Blend pose a into b by k (0..1), into dst; upper: only the upper body. The hands swing on arcs about the
// shoulder and the feet about the hip, so a hand passing the shoulder never flips the arm.
const SCALARS = ['hx', 'hy', 'lean', 'st', 'hdx', 'hdy', 'ga'], UPPER_S = ['lean', 'hdx', 'hdy', 'ga'];
function mixInto(dst, a, b, k, upper = false) {
  if (k <= 0 || k >= 1) {
    const src = k <= 0 ? a : b;
    for (const f of upper ? UPPER : FIELDS) dst[f] = src[f];
    return;
  }
  for (const f of upper ? UPPER_S : SCALARS) dst[f] = a[f] + (b[f] - a[f]) * k;
  arc(dst, a, b, k, 'bx', 'by', S_X, S_Y, S_X, S_Y, S_X, S_Y);
  arc(dst, a, b, k, 'fx', 'fy', S_X, S_Y, S_X, S_Y, S_X, S_Y);
  if (upper) return;
  arc(dst, a, b, k, 'lbx', 'lby', a.hx, a.hy, b.hx, b.hy, dst.hx, dst.hy);
  arc(dst, a, b, k, 'lfx', 'lfy', a.hx, a.hy, b.hx, b.hy, dst.hx, dst.hy);
}
// One point of a pose, blended in polar form about its origin (a's, b's, and dst's).
function arc(dst, a, b, k, kx, ky, ax, ay, bx, by, dx, dy) {
  const ux = a[kx] - ax, uy = a[ky] - ay, vx = b[kx] - bx, vy = b[ky] - by;
  const ra = Math.hypot(ux, uy), ta = Math.atan2(uy, ux);
  let d = Math.atan2(vy, vx) - ta;
  if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
  const r = ra + (Math.hypot(vx, vy) - ra) * k, t = ta + d * k;
  dst[kx] = dx + r * Math.cos(t);
  dst[ky] = dy + r * Math.sin(t);
}

// Layer 1, locomotion (stickman spec §3 "Choosing the locomotion pose"), into L; then the front arm aimed.
function locomotion(s, rm, breath) {
  if (!s.ground) {
    // One smooth blend over vy: rise → apex → fall.
    const k = smooth((s.vy + AIR_VY) / (2 * AIR_VY));
    if (k < 0.5) mixInto(L, RISE, APEX, 2 * k); else mixInto(L, APEX, FALL, 2 * k - 1);
    return;
  }
  copy(L, IDLE);
  L.st = breath;
  const w = Math.abs(s.vx) < RUN_VX ? 0 : smooth((Math.abs(s.vx) - RUN_VX) / (RUN_FULL - RUN_VX));
  if (w > 0) run(s, rm, w);
  // Land: the hip drops, bending the knees; the feet plant wide; the arms come down from the fall.
  if (!rm && s.landT < LAND_T) {
    const k = 1 - s.landT / LAND_T;
    L.hy += LAND_DROP * k;
    L.lbx += (-LAND_FEET - L.lbx) * k; L.lby += (FEET - L.lby) * k;
    L.lfx += (LAND_FEET - L.lfx) * k; L.lfy += (FEET - L.lfy) * k;
    L.bx += (FALL.bx - L.bx) * k; L.by += (FALL.by - L.by) * k;
  }
}

// The run cycle, weighted in by speed: phase from x alone (stickman spec §4 "Run"), each foot on an
// ellipse (back along the ground, then lifted forward), the back arm against the front leg.
function run(s, rm, w) {
  const ph = frac((s.x * s.facing) / STRIDE), psi = 2 * Math.PI * ph;
  const c = Math.cos(psi), sn = Math.sin(psi);
  const fwd = s.vx * s.facing > 0, speed = Math.abs(s.vx);
  const lean = fwd ? RUN.lean + (RUN.sprint - RUN.lean) * clamp01((speed - SPRINT_VX0) / (SPRINT_VX1 - SPRINT_VX0)) : 0;
  const bob = rm ? 0 : RUN.bob * Math.sin(Math.PI * frac(ph * 2));
  toward('lean', lean, w);
  toward('st', 0, w);
  toward('hy', 1 + RUN.drop - bob, w);
  toward('lfx', RUN.step * c, w); toward('lfy', FEET - RUN.lift * Math.max(0, -sn), w);
  toward('lbx', -RUN.step * c, w); toward('lby', FEET - RUN.lift * Math.max(0, sn), w);
  toward('bx', RUN.bx - RUN.swing * c, w); toward('by', RUN.by + RUN.raise * c, w);
  toward('fy', IDLE.fy - RUN.pump * Math.abs(sn), w);
}
function toward(k, v, w) { L[k] += (v - L[k]) * w; }

// Recoil, 1 = fully back: full until 0.04 s, easing to 0 by 0.15. Reduce Motion: on for 0.08 s, no ease.
function recoil(actT, rm) {
  if (rm) return actT < 0.08 ? 1 : 0;
  return actT < 0.04 ? 1 : Math.max(0, 1 - (actT - 0.04) / 0.11);
}

// An act's weight over time: in over [0, t0], held, out over [t1, t2].
const weight = (t, t0, t1, t2) => (t < t0 ? smooth(t / t0) : t < t1 ? 1 : 1 - smooth((t - t1) / (t2 - t1)));

// The acts (layers 2 and 3), one row each: the wind-up and strike keyposes, and when (seconds of actT) it is
// blended in from locomotion (in), at the strike (at), held until (hold) and back in locomotion (end).
// upper: only the upper body (the legs keep running or flying); air: the back foot in the air instead;
// turns: whole forward turns about the pivot over the act, drawn with no gun; puff: a puff where it began.
// A new whole-body act is a new row.
const ACT_RIG = {
  punch: { wind: PUNCH_WIND, strike: PUNCH_STRIKE, in: 0.04, at: 0.06, hold: 0.16, end: 0.25, upper: true },
  kick: { wind: KICK_WIND, strike: KICK_STRIKE, in: 0.04, at: 0.06, hold: 0.26, end: 0.4, air: KICK_AIR_BACK },
  hurt: { wind: HURT, strike: HURT, in: 0.02, at: 0.02, hold: 0.2, end: 0.35 },
  roll: { wind: TUCK, strike: TUCK, in: 0.05, at: 0.05, hold: 0.25, end: 0.3, turns: 1, puff: true },
};

// The acts that take over from the flip: a kick, a hurt, the roll. Once one has overlapped the flip (it was
// still going when the air jump came, or began after), the flip is over for that air jump: it never comes
// back mid-turn. pvp.js and fighters.js then report flipT as Infinity, once the act itself has ended too.
const TAKES_OVER = { kick: true, hurt: true, roll: true };
export function flipCut(act, actT, flipT) {
  return TAKES_OVER[act] === true && flipT < FLIP.time && actT - flipT < ACT_RIG[act].end;
}

// Layers 2 and 3 into P (from L). Returns the turn about the pivot (radians), or 0.
function act(name, actT, ground) {
  copy(P, L);
  const r = ACT_RIG[name];
  if (!r || actT >= r.end) return 0;
  mixInto(A, r.wind, r.strike, r.at > r.in ? smooth((actT - r.in) / (r.at - r.in)) : 1, r.upper);
  if (r.air && !ground) {
    const k = smooth(actT / r.at);
    A.lbx += (r.air.lbx - A.lbx) * k;
    A.lby += (r.air.lby - A.lby) * k;
  }
  mixInto(P, L, A, weight(actT, r.in, r.hold, r.end), r.upper);
  if (!r.turns) return 0;
  const u = actT / r.end;
  return 2 * Math.PI * r.turns * (0.5 * u + 0.5 * smooth(u));
}

// The solved rig, facing right, in u: hip, neck, head, shoulder, and each limb's joint and end.
const J = {
  hx: 0, hy: 0, nx: 0, ny: 0, ox: 0, oy: 0, sx: 0, sy: 0,
  ebx: 0, eby: 0, wbx: 0, wby: 0, efx: 0, efy: 0, wfx: 0, wfy: 0,
  kbx: 0, kby: 0, abx: 0, aby: 0, kfx: 0, kfy: 0, afx: 0, afy: 0,
};
let jx = 0, jy = 0, tx = 0, ty = 0;

// Two-bone IK: from the root (rx, ry) toward the target, bones a then b. bend +1 puts the joint back and
// down (elbows), -1 forward (knees). Sets (jx, jy) the joint and (tx, ty) the end.
function ik(rx, ry, px, py, a, b, bend) {
  let dx = px - rx, dy = py - ry, d = Math.hypot(dx, dy);
  if (d < 1e-9) { dx = 0; dy = 1; d = 1e-9; } else { dx /= d; dy /= d; }
  d = Math.min(Math.max(d, Math.abs(a - b) + 1e-6), (a + b) * REACH);
  const ca = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)));
  const sa = bend * Math.sqrt(1 - ca * ca);
  jx = rx + a * (dx * ca - dy * sa);
  jy = ry + a * (dx * sa + dy * ca);
  tx = rx + d * dx;
  ty = ry + d * dy;
}

function solve(p) {
  const s = Math.sin(p.lean), c = Math.cos(p.lean), len = RIG.torso + p.st;
  J.hx = p.hx; J.hy = p.hy;
  J.nx = p.hx + len * s; J.ny = p.hy - len * c;
  J.ox = J.nx + HEAD_D * s + p.hdx; J.oy = J.ny - HEAD_D * c + p.hdy;
  // The shoulder: S_X ahead of the torso line, NECK_TO_S below the neck, turning with the lean.
  J.sx = J.nx + S_X * c - NECK_TO_S * s; J.sy = J.ny + S_X * s + NECK_TO_S * c;
  const ox = J.sx - S_X, oy = J.sy - S_Y; // the hands move with the shoulder
  ik(J.sx, J.sy, p.bx + ox, p.by + oy, RIG.upperArm, RIG.foreArm, 1);
  J.ebx = jx; J.eby = jy; J.wbx = tx; J.wby = ty;
  ik(J.sx, J.sy, p.fx + ox, p.fy + oy, RIG.upperArm, RIG.foreArm, 1);
  J.efx = jx; J.efy = jy; J.wfx = tx; J.wfy = ty;
  ik(J.hx, J.hy, p.lbx, p.lby, RIG.thigh, RIG.shin, -1);
  J.kbx = jx; J.kby = jy; J.abx = tx; J.aby = ty;
  ik(J.hx, J.hy, p.lfx, p.lfy, RIG.thigh, RIG.shin, -1);
  J.kfx = jx; J.kfy = jy; J.afx = tx; J.afy = ty;
}

// Turn the whole solved rig by phi about (0, py): the roll (about its pivot), the flip (about the centre).
const XS = ['hx', 'nx', 'ox', 'sx', 'ebx', 'wbx', 'efx', 'wfx', 'kbx', 'abx', 'kfx', 'afx'];
const YS = ['hy', 'ny', 'oy', 'sy', 'eby', 'wby', 'efy', 'wfy', 'kby', 'aby', 'kfy', 'afy'];
function turn(phi, py = PIVOT_Y) {
  const c = Math.cos(phi), s = Math.sin(phi);
  for (let i = 0; i < XS.length; i++) {
    const x = J[XS[i]], y = J[YS[i]] - py;
    J[XS[i]] = x * c - y * s;
    J[YS[i]] = x * s + y * c + py;
  }
}

// A bar's rotation, clockwise from upright, kept within (-π/2, π/2] (a bar is the same either way up).
function barRot(dx, dy) {
  let r = Math.atan2(dx, -dy);
  if (r > Math.PI / 2) r -= Math.PI; else if (r <= -Math.PI / 2) r += Math.PI;
  return r;
}

// Output, facing right in u → { dx, dy } in cells and rows, mirrored by f.
function put(out, f, ch, x, y, part, tone, a, rot, len, flip) {
  out.push({ dx: x * f + 0, dy: y / 2 + 0, ch, part, tone, a, rot: rot * f + 0, len, flip });
}
function bone(out, f, part, ax, ay, bx, by, tone, a) {
  const dx = bx - ax, dy = by - ay;
  put(out, f, '|', (ax + bx) / 2, (ay + by) / 2, part, tone, a, barRot(dx, dy), Math.hypot(dx, dy) / RIG.bar, false);
}

// The figure from J: the head, the torso, the back limbs, the front leg, the front arm.
function figure(out, f, tone, a) {
  put(out, f, 'O', J.ox, J.oy, 'head', tone, a, 0, 1, false);
  bone(out, f, 'torso', J.hx, J.hy, J.nx, J.ny, tone, a);
  bone(out, f, 'armB', J.sx, J.sy, J.ebx, J.eby, tone, a);
  bone(out, f, 'armB', J.ebx, J.eby, J.wbx, J.wby, tone, a);
  bone(out, f, 'legB', J.hx, J.hy, J.kbx, J.kby, tone, a);
  bone(out, f, 'legB', J.kbx, J.kby, J.abx, J.aby, tone, a);
  bone(out, f, 'legF', J.hx, J.hy, J.kfx, J.kfy, tone, a);
  bone(out, f, 'legF', J.kfx, J.kfy, J.afx, J.afy, tone, a);
  bone(out, f, 'armF', J.sx, J.sy, J.efx, J.efy, tone, a);
  bone(out, f, 'armF', J.efx, J.efy, J.wfx, J.wfy, tone, a);
}

// The gun, from the front hand along angle ga: the hand glyph at the hand, the rest 1 u apart.
// Returns nothing; sets (tx, ty) to the muzzle, half a glyph past the last glyph.
function gunAt(out, f, gun, ga, tone, a) {
  const art = GUN_ART[gun], c = Math.cos(ga), s = Math.sin(ga), g = art.glyphs;
  for (let i = 0; i < g.length; i++) {
    const r = i - art.hand;
    put(out, f, g[i], J.wfx + r * c, J.wfy + r * s, 'gun', tone, a, ga, 1, f < 0);
  }
  const m = g.length - 1 - art.hand + 0.5;
  tx = J.wfx + m * c;
  ty = J.wfy + m * s;
}

// Out is the direction of (dx, dy) from the centre on screen, `d` screen units long, in cells and rows.
let outDx = 0, outDy = 0;
function outward(dx, dy, d) {
  const len = Math.hypot(dx, 2 * dy);
  if (len < 1e-9) { outDx = 0; outDy = -d / 2; return; }
  outDx = (d * dx) / len;
  outDy = (d * dy) / len;
}

// The dead body's pieces, worked out once from the hurt pose (closed form): flight 1 from its place to its
// rest line, a bounce (vertical speed reversed at ×0.3, horizontal halved), flight 2, then rest. Each bar
// spins at about SPIN rad/s, its rate trimmed so it lands flat.
let PIECES = null;
function pieces() {
  if (PIECES) return PIECES;
  copy(P, HURT);
  solve(P);
  const tmp = [];
  figure(tmp, 1, 'body', 1);
  PIECES = tmp.map((g, i) => {
    const [vx, vy] = SCATTER_V[g.part], floor = g.part === 'head' ? REST_HEAD : REST_BONE;
    const t1 = (-vy + Math.sqrt(vy * vy + 2 * GRAV * (floor - g.dy))) / GRAV;
    const x1 = g.dx + vx * t1, vy2 = -BOUNCE * (vy + GRAV * t1), vx2 = vx / 2;
    const t2 = (-2 * vy2) / GRAV, end = t1 + t2;
    let spin = 0;
    if (g.part !== 'head') {
      const want = g.rot + (i % 2 ? SPIN : -SPIN) * end;
      spin = (Math.PI / 2 + Math.PI * Math.round((want - Math.PI / 2) / Math.PI) - g.rot) / end;
    }
    return { ...g, vx, vy, floor, t1, x1, vx2, vy2, t2, end, x2: x1 + vx2 * t2, spin };
  });
  return PIECES;
}

// The dead body: the pop, the scatter, the rest and the fade. Pieces are relative to the body.
function dead(out, f, actT, rm, sa) {
  if (actT >= DEAD_END) return out;
  const a = (actT <= FADE_T ? 1 : (DEAD_END - actT) / (DEAD_END - FADE_T)) * sa;
  const tau = actT - POP_T, pop = !rm && actT < POP_T;
  for (const p of pieces()) {
    let dx, dy, rot;
    if (pop) {
      dx = p.dx; dy = p.dy; rot = p.rot;
    } else if (rm || tau >= p.end) {
      dx = p.x2; dy = p.floor; rot = p.part === 'head' ? 0 : Math.PI / 2;
    } else if (tau < p.t1) {
      dx = p.dx + p.vx * tau;
      dy = Math.min(p.floor, p.dy + p.vy * tau + (GRAV * tau * tau) / 2);
      rot = p.rot + p.spin * tau;
    } else {
      const u = tau - p.t1;
      dx = p.x1 + p.vx2 * u;
      dy = Math.min(p.floor, p.floor + p.vy2 * u + (GRAV * u * u) / 2);
      rot = p.rot + p.spin * tau;
    }
    if (rot > Math.PI / 2 || rot <= -Math.PI / 2) rot -= Math.PI * Math.ceil((rot - Math.PI / 2) / Math.PI);
    out.push({ dx: dx * f + 0, dy, ch: p.ch, part: p.part, tone: pop ? 'flash' : 'body', a, rot: rot * f + 0, len: p.len, flip: false });
  }
  // The pop's sparks: 4 '*' flying out diagonally, fading out by 0.25 s.
  if (!rm && actT < SPARK_T) {
    const k = actT / SPARK_T, r = SPARK_R0 + (SPARK_R1 - SPARK_R0) * k;
    for (const sx of SIGNS) for (const sy of SIGNS) put(out, f, '*', sx * r * SPARK_D, sy * r * SPARK_D, 'fx', 'fx', 1 - k, 0, 1, false);
  }
  return out;
}

// Respawn, over whatever pose was drawn from `start` on: each sprite flies in from 3 out along its own
// direction from the centre (the gun as one piece), easing out, while `a` goes 0 → 1; then a white
// flash to 0.45 s. Reduce Motion: a 0.3 s fade-in in place.
function spawnIn(out, start, spawnT, rm) {
  if (rm) {
    const a = Math.min(1, spawnT / SPAWN_RM);
    for (let i = start; i < out.length; i++) out[i].a *= a;
    return out;
  }
  if (spawnT >= SPAWN_FLY) {
    for (let i = start; i < out.length; i++) if (out[i].tone !== 'fx') out[i].tone = 'flash';
    return out;
  }
  const k = spawnT / SPAWN_FLY, d = SPAWN_R * (1 - k) ** 3;
  let gunDx = 0, gunDy = 0, gunSet = false;
  for (let i = start; i < out.length; i++) {
    const g = out[i];
    if (g.part === 'gun') {
      if (!gunSet) { outward(g.dx, g.dy, d); gunDx = outDx; gunDy = outDy; gunSet = true; }
      g.dx += gunDx;
      g.dy += gunDy;
    } else {
      outward(g.dx, g.dy, d);
      g.dx += outDx;
      g.dy += outDy;
    }
    g.a *= k;
  }
  return out;
}

// stickPose(state, t, opts, out) → out, with the body's sprites { dx, dy, ch, part, tone, a, rot, len, flip }
// appended (stickman spec §3, rig addendum §3). Pure: never mutates state, no randomness.
export function stickPose(state, t, opts = {}, out = []) {
  const st = state || {};
  const start = out.length;
  drawPose(st, t, opts, out);
  // The respawn goes over the pose; dead replaces everything, the respawn included.
  const spawnT = st.spawnT >= 0 ? st.spawnT : Infinity;
  if (spawnT < SPAWN_END && st.act !== 'dead') spawnIn(out, start, spawnT, !!(opts && opts.reducedMotion));
  return out;
}

function drawPose(st, t, opts, out) {
  const vx = fin(st.vx, 0);
  const s = {
    x: fin(st.x, 0), vx, vy: fin(st.vy, 0),
    facing: st.facing < 0 ? -1 : st.facing > 0 ? 1 : vx < 0 ? -1 : 1,
    ground: st.ground !== false,
    landT: st.landT >= 0 ? st.landT : Infinity,
  };
  const name = ACTS[st.act] === true ? st.act : 'idle';
  const actT = fin(st.actT, 0) > 0 ? st.actT : 0;
  const aim = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, fin(st.aim, 0)));
  const gun = GUN_ART[st.gun] ? st.gun : 'deagle';
  const rm = !!(opts && opts.reducedMotion);
  const phase = fin(opts && opts.phase, 0);
  const tt = fin(t, 0);
  const f = s.facing;
  // Protection: the body's opacity pulses 3 times a second; Reduce Motion holds it at 0.5.
  const sa = st.safe === true ? (rm ? SAFE_RM : SAFE_MID + SAFE_AMP * Math.cos(2 * Math.PI * SAFE_HZ * tt)) : 1;

  if (name === 'dead') return dead(out, f, actT, rm, sa);

  const breath = rm ? 0 : BREATH_U * (1 - Math.cos(2 * Math.PI * (tt / BREATH_PERIOD + phase))) / 2;
  locomotion(s, rm, breath);

  // The front arm aimed (shooting, aimed, or any aim): the hand at S + HAND_R along the aim, less the recoil.
  const shooting = name === 'shoot';
  const aimed = shooting || st.aimed === true || aim !== 0;
  const k = shooting ? recoil(actT, rm) : 0;
  if (aimed) {
    const r = HAND_R - RECOIL * k;
    L.fx = S_X + r * Math.cos(aim);
    L.fy = S_Y + r * Math.sin(aim);
    L.ga = aim;
    L.lean -= RECOIL_LEAN * k;
  }

  const phi = act(name, actT, s.ground);
  const rolling = ACT_RIG[name] && ACT_RIG[name].turns > 0 && actT < ACT_RIG[name].end;
  // The flip, while flipT is short of its end; a kick, a hurt or a roll takes over from it for good.
  const flipT = st.flipT >= 0 ? st.flipT : Infinity;
  const flipping = !flipCut(name, actT, flipT) && flipT < (rm ? FLIP.rm : FLIP.time);
  let spin = 0, ga = P.ga, handX = 0, handY = 0;
  if (flipping) {
    // Aimed, the hand and gun stay where they'd be without the flip: the hand as solved now.
    if (aimed) { solve(P); handX = J.wfx; handY = J.wfy; }
    const w = rm ? weight(flipT, FLIP.rmIn, FLIP.rm - FLIP.rmOut, FLIP.rm) : weight(flipT, FLIP.in, FLIP.time - FLIP.out, FLIP.time);
    copy(Q, FLIP_TUCK);
    Q.lean = P.lean;
    copy(A, P);
    mixInto(P, A, Q, w);
    // One forward turn, eased out; none with Reduce Motion.
    if (!rm) { const k = flipT / FLIP.time; spin = 2 * Math.PI * (1 - (1 - k) * (1 - k)); }
    ga = aimed ? ga : P.ga + spin;
  }
  solve(P);
  let tone = 'body';
  if (name === 'hurt' && actT < HURT_FLASH && !rm) tone = 'flash';

  if (rolling) {
    turn(phi);
    figure(out, f, tone, sa);
    // The puff where the roll started: behind the body by the distance rolled.
    if (!rm && ACT_RIG[name].puff && actT < PUFF_T) put(out, f, '~', -actT * PUFF_V, 2, 'fx', 'fx', 1, 0, 1, false);
    return airPuff(out, f, s, flipT, rm);
  }

  if (flipping) {
    turn(spin, 0);
    // Aimed: the front arm reaches from the turning shoulder to the hand where it would be.
    if (aimed) {
      ik(J.sx, J.sy, handX, handY, RIG.upperArm, RIG.foreArm, 1);
      J.efx = jx; J.efy = jy; J.wfx = tx; J.wfy = ty;
    }
  }
  figure(out, f, tone, sa);
  gunAt(out, f, gun, ga, tone, sa);
  if (shooting && actT < FLASH_T) put(out, f, '*', tx, ty, 'fx', 'fx', 1, 0, 1, false);
  // The whoosh: 0.05 s at the end of a strike, just past the fist or the foot.
  if (actT >= WHOOSH_T0 && actT < WHOOSH_T1 && (name === 'punch' || name === 'kick')) {
    const ex = name === 'punch' ? J.wfx : J.afx, ey = name === 'punch' ? J.wfy : J.afy;
    put(out, f, f < 0 ? '(' : ')', ex + WHOOSH_D, ey, 'fx', 'fx', 1, 0, 1, false);
  }
  return airPuff(out, f, s, flipT, rm);
}

// The air jump's puff: two ~ spreading sideways from the feet where the jump was, fading. The body has
// moved on since by its speed and gravity, so the jump point is worked back from vx and vy.
function airPuff(out, f, s, flipT, rm) {
  if (rm || !(flipT < PUFF2.time)) return out;
  const t = flipT, k = t / PUFF2.time;
  const x = -s.vx * t, y = 2 * ((G_ROWS * t * t) / 2 - s.vy * t) + FEET;
  const r = PUFF2.r0 + (PUFF2.r1 - PUFF2.r0) * (1 - (1 - k) * (1 - k));
  put(out, f, '~', f * x - r, y, 'fx', 'fx', 1 - k, 0, 1, false);
  put(out, f, '~', f * x + r, y, 'fx', 'fx', 1 - k, 0, 1, false);
  return out;
}

// createMotionMemory() → { fill(id, state, t) → state }: fills in landT and spawnT, which are never synced
// (stickman spec §6). landT: seconds since ground went false → true (Infinity in the air or before
// any landing). spawnT: seconds since first seen or since `dead` turned into anything else. An id not
// seen for 5 s is forgotten.
export function createMotionMemory() {
  const FORGET = 5;
  const seen = new Map();
  let swept = -Infinity;
  return {
    fill(id, state, t) {
      if (t - swept > 1) {
        for (const [k, m] of seen) if (t - m.last > FORGET) seen.delete(k);
        swept = t;
      }
      const ground = state.ground !== false, isDead = state.act === 'dead';
      let m = seen.get(id);
      if (m && t - m.last > FORGET) m = undefined;
      if (!m) {
        m = { ground, dead: isDead, landAt: -Infinity, spawnAt: t, last: t };
        seen.set(id, m);
      } else {
        if (ground && !m.ground) m.landAt = t;
        if (m.dead && !isDead) m.spawnAt = t;
        m.ground = ground;
        m.dead = isDead;
        m.last = t;
      }
      state.landT = ground ? Math.max(0, t - m.landAt) : Infinity;
      state.spawnT = Math.max(0, t - m.spawnAt);
      return state;
    },
  };
}
