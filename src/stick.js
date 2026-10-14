// The arena's stick figures: pose art and the gun constants the rules share. Pure: no DOM, no randomness.

export const SHOULDER = { dx: 0.15, dy: -0.3 };
export const HAND_R = 1.3;
export const MUZZLE_R = { deagle: 2.8, rifle: 4.8, sniper: 6.8 };
// hand is the index of the glyph at the hand.
export const GUN_ART = {
  deagle: { glyphs: '╦═', hand: 0 },
  rifle: { glyphs: '═╦╤══', hand: 1 },
  sniper: { glyphs: '═╦═°═══', hand: 1 },
};

// Facing left draws the facing-right art with dx negated and these characters swapped.
export const MIRROR = { '/': '\\', '\\': '/', '<': '>', '>': '<', '(': ')', ')': '(' };

const PARTS = ['head', 'armB', 'torso', 'armF', 'legB', 'legF'];

// Locomotion art, facing right (stickman spec §4): part → [ch, dx, dy]; null means not drawn.
const IDLE = { head: ['O', 0, -1], armB: ['/', -0.7, 0], torso: ['|', 0, 0], armF: ['\\', 0.7, 0], legB: ['/', -0.4, 1], legF: ['\\', 0.4, 1] };
const LAND_LEGS = { legB: ['/', -0.6, 1], legF: ['\\', 0.6, 1] };
// The run frames R1–R4. The head and torso come from the lean.
const RUN = [
  { armB: ['-', -0.55, -0.1], armF: ['\\', 0.85, 0.05], legB: ['/', -0.55, 1], legF: ['\\', 0.6, 1] },
  { armB: ['/', -0.45, 0.05], armF: null, legB: ['|', 0.05, 1], legF: ['>', 0.6, 0.9] },
  { armB: ['/', -0.5, 0.05], armF: ['-', 0.95, -0.1], legB: ['/', -0.55, 1], legF: ['\\', 0.6, 1] },
  { armB: null, armF: ['\\', 0.75, 0.05], legB: ['|', 0.05, 1], legF: ['>', 0.6, 0.9] },
];
const RISE = { head: ['O', 0.1, -1], armB: ['\\', -0.7, -1.1], torso: ['|', 0, 0], armF: ['/', 0.8, -1.1], legB: ['/', -0.3, 0.95], legF: ['>', 0.45, 0.85] };
const APEX = { head: ['O', 0, -1], armB: ['-', -0.75, -0.1], torso: ['|', 0, 0], armF: ['-', 0.75, -0.1], legB: ['/', -0.3, 0.9], legF: ['>', 0.45, 0.85] };
const FALL = { head: ['O', 0, -1], armB: ['\\', -0.75, -0.25], torso: ['|', 0, 0], armF: ['/', 0.75, -0.25], legB: ['/', -0.55, 1], legF: ['\\', 0.55, 1] };

// Timings and sizes (stickman spec §4 "Animation timing").
const BREATH_PERIOD = 2.4, BREATH_H = 0.06;
const STRIDE = 12, BOB_H = 0.12, RUN_VX = 1.5, SPRINT_VX = 36;
const AIR_VY = 8;
const LAND_T = 0.12, SQUASH = 0.25;
const ARM_R = 0.7, RECOIL = 0.3, HEAD_RECOIL = 0.1, FLASH_T = 0.06;
const STEEP = 35 * Math.PI / 180;
const HIP = { dx: 0.45, dy: 0.3 };

// Action art, facing right (stickman spec §4 "Punch", "Kick", "Hurt"): part → [ch, dx, dy].
const PUNCH_WIND = { torso: ['\\', -0.1, 0], head: ['O', -0.2, -1], armF: ['>', 0.45, -0.15] };
const PUNCH_STRIKE = { torso: ['/', 0.2, 0], head: ['O', 0.4, -1], armB: ['-', -0.6, -0.1], armF: ['-', 0.85, -0.2] };
const PUNCH_FIST = ['-', 1.55, -0.2], PUNCH_WHOOSH = [')', 2.1, -0.2];
const KICK_WIND = { armB: ['-', -0.75, -0.1], torso: IDLE.torso, armF: ['-', 0.75, -0.1], legB: ['|', -0.1, 1], legF: ['>', 0.45, 0.75] };
// The strike's head is a shift of the head from where locomotion put it.
const KICK_STRIKE = { armB: ['/', -0.8, 0.1], torso: ['\\', -0.15, 0], armF: ['-', 0.6, -0.15], legB: ['/', -0.35, 1], legF: ['-', 0.75, 0.55] };
const KICK_HEAD_DX = -0.35, KICK_AIR_LEGB = ['/', -0.35, 0.85];
const KICK_FOOT = ['-', 1.45, 0.55], KICK_WHOOSH = [')', 2.0, 0.55];
// The parts each act sets (the rest come from locomotion).
const PUNCH_PARTS = ['torso', 'head', 'armB', 'armF'], KICK_PARTS = ['armB', 'torso', 'armF', 'legB', 'legF'];
const HURT = { head: ['O', -0.5, -0.9], armB: ['/', -0.85, 0.15], torso: ['\\', -0.2, 0], armF: ['-', 0.55, -0.25], legB: ['/', -0.4, 1], legF: ['\\', 0.4, 1] };

// Action timings (stickman spec §4): wind-up end, strike end, the characters' switch back, done.
const PUNCH_T = { wind: 0.06, strike: 0.16, swap: 0.21, end: 0.25 };
const KICK_T = { wind: 0.06, strike: 0.26, swap: 0.33, end: 0.4 };
const HURT_T = { flash: 0.08, strike: 0.2, swap: 0.28, end: 0.35 };
const WHOOSH_T0 = 0.06, WHOOSH_T1 = 0.11;

// Roll (stickman spec §4 "Roll"): 4 frames of 0.075 s, rows dy 0 and 1, columns at ROLL_X.
const ROLL_T = 0.075, ROLL_END = 0.3, PUFF_T = 0.1, PUFF_V = 48;
const ROLL_X = [-0.7, 0, 0.7];
const ROLL = [['.o.', "'-'"], ['.-.', "'-o"], ['.-.', "'o'"], ['o-.', "'-'"]];

// Death (stickman spec §4 "Death: pop and scatter").
const POP_T = 0.08, SPARK_T = 0.25, SPARK_R0 = 0.5, SPARK_R1 = 1.5;
const GRAV = 50, BOUNCE = 0.3, FLOOR = 1, TUMBLE_RATE = 12, FADE_T = 1.4, DEAD_END = 2.0;
const TUMBLE = ['|', '/', '-', '\\'];
const SCATTER_V = { head: [-7, -14], torso: [-3, -9], armB: [-10, -11], armF: [4, -12], legB: [-5, -6], legF: [3, -7] };
const SPARK_D = Math.SQRT1_2, SIGNS = [-1, 1];

// Respawn and protection (stickman spec §4 "Respawn", §3 `safe`, §5 "Reduce Motion").
const SPAWN_FLY = 0.35, SPAWN_END = 0.45, SPAWN_R = 3, SPAWN_RM = 0.3;
const SAFE_MID = 0.575, SAFE_AMP = 0.225, SAFE_HZ = 3, SAFE_RM = 0.5;

const ACTS = { idle: true, shoot: true, punch: true, kick: true, hurt: true, dead: true, roll: true };

// Each piece's scatter, worked out once (closed form): flight 1 from its hurt-pose place to the feet
// line, a bounce (vertical speed reversed at ×0.3, horizontal halved), flight 2 to the line, then rest.
const SCATTER = {};
for (const k of PARTS) {
  const [, x0, y0] = HURT[k], [vx, vy] = SCATTER_V[k];
  const t1 = (-vy + Math.sqrt(vy * vy + 2 * GRAV * (FLOOR - y0))) / GRAV;
  const x1 = x0 + vx * t1, vy2 = -BOUNCE * (vy + GRAV * t1), vx2 = vx / 2;
  const t2 = (-2 * vy2) / GRAV;
  SCATTER[k] = { x0, y0, vx, vy, t1, x1, vx2, vy2, t2, x2: x1 + vx2 * t2 };
}

// Scratch poses, reused so a call allocates nothing beyond the glyphs it pushes.
// Each part is { ch, dx, dy } facing right; ch null means not drawn.
// P is the pose being built; B keeps the locomotion pose (with its arm) for the recover phases.
const P = {}, B = {};
for (const k of PARTS) { P[k] = { ch: null, dx: 0, dy: 0 }; B[k] = { ch: null, dx: 0, dy: 0 }; }
// An extra glyph (the fist or the foot) and a whoosh; ch null means none.
const X = { ch: null, dx: 0, dy: 0, part: 'armF' };
const W = { ch: null, dx: 0, dy: 0 };
// Where locomotion moved the torso: the aimed shoulder moves with it.
let bodyDx = 0, bodyDy = 0;

const fin = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const frac = (v) => v - Math.floor(v);

function set(part, art, ox, oy) {
  const p = P[part];
  if (!art) { p.ch = null; return; }
  p.ch = art[0];
  p.dx = art[1] + ox;
  p.dy = art[2] + oy;
}

function setPose(art, upper, legs) {
  set('head', art.head, 0, upper);
  set('armB', art.armB, 0, upper);
  set('torso', art.torso, 0, upper);
  set('armF', art.armF, 0, upper);
  set('legB', art.legB, 0, legs);
  set('legF', art.legF, 0, legs);
}

function setGlyph(g, art, ox, oy) {
  g.ch = art[0];
  g.dx = art[1] + ox;
  g.dy = art[2] + oy;
}

// Layer 1: locomotion fills P and sets bodyDx/bodyDy (stickman spec §3 "Choosing the locomotion pose").
function locomotion(s, rm, breath) {
  bodyDx = 0;
  if (!s.ground) {
    setPose(s.vy < -AIR_VY ? RISE : s.vy > AIR_VY ? FALL : APEX, 0, 0);
    bodyDy = 0;
  } else if (!rm && s.landT < LAND_T) {
    // Land: the idle figure, upper rows squashed down, legs spread. Reduce Motion has no squash.
    bodyDy = SQUASH * (1 - s.landT / LAND_T) - breath;
    setPose(IDLE, bodyDy, 0);
    set('legB', LAND_LEGS.legB, 0, 0);
    set('legF', LAND_LEGS.legF, 0, 0);
  } else if (Math.abs(s.vx) >= RUN_VX) {
    const ph = frac((s.x * s.facing) / STRIDE);
    const f = RUN[Math.min(3, Math.floor(ph * 4))];
    const bob = rm ? 0 : -BOB_H * Math.sin(Math.PI * frac(ph * 2));
    // Running backwards (facing disagrees with vx): no lean, torso upright.
    const fwd = s.vx * s.facing > 0, sprint = Math.abs(s.vx) > SPRINT_VX;
    const lean = fwd ? (sprint ? 0.3 : 0.2) : 0, headLean = fwd ? (sprint ? 0.45 : 0.35) : 0;
    set('head', IDLE.head, headLean, bob);
    set('torso', IDLE.torso, lean, bob);
    if (fwd) P.torso.ch = '/';
    set('armB', f.armB, 0, bob);
    set('armF', f.armF, 0, bob);
    set('legB', f.legB, 0, bob);
    set('legF', f.legF, 0, bob);
    bodyDx = lean;
    bodyDy = bob;
  } else {
    bodyDy = -breath;
    setPose(IDLE, bodyDy, 0);
  }
}

// The arm's glyph for an aim, facing right: 8 directions.
function armGlyph(aim) {
  const a = Math.abs(aim);
  if (a <= Math.PI / 8) return '-';
  if (a <= (3 * Math.PI) / 8) return aim < 0 ? '/' : '\\';
  return '|';
}

// Recoil, 1 = fully back: full until 0.04 s, easing to 0 by 0.15. Reduce Motion: on for 0.08 s, no ease.
function recoil(actT, rm) {
  if (rm) return actT < 0.08 ? 1 : 0;
  return actT < 0.04 ? 1 : Math.max(0, 1 - (actT - 0.04) / 0.11);
}

// Carried: the arm is '-' halfway from the shoulder to the hand at the hip, moving with the torso.
function carryArm() {
  P.armF.ch = '-';
  P.armF.dx = (SHOULDER.dx + HIP.dx) / 2 + P.torso.dx;
  P.armF.dy = (SHOULDER.dy + HIP.dy) / 2 + P.torso.dy;
}

function copyPose(dst, src) {
  for (const k of PARTS) {
    dst[k].ch = src[k].ch;
    dst[k].dx = src[k].dx;
    dst[k].dy = src[k].dy;
  }
}

// Recover: every part slides from the action pose in P back to its locomotion place in B (u 0 → 1).
// Once swapped, the characters are the locomotion ones and the extra glyph is gone.
function recover(u, swapped) {
  for (const k of PARTS) {
    const p = P[k], b = B[k];
    if (p.ch === null) { p.ch = b.ch; p.dx = b.dx; p.dy = b.dy; continue; }
    if (b.ch !== null) {
      p.dx += (b.dx - p.dx) * u;
      p.dy += (b.dy - p.dy) * u;
    }
    if (swapped) p.ch = b.ch;
  }
  if (X.ch !== null) {
    const b = B[X.part];
    X.dx += (b.dx - X.dx) * u;
    X.dy += (b.dy - X.dy) * u;
    if (swapped) X.ch = null;
  }
}

// Layer 2, punch: replaces armF (and the torso, head and back arm), moving up and down with the torso.
function punch(actT) {
  const oy = bodyDy;
  if (actT < PUNCH_T.wind) {
    set('torso', PUNCH_WIND.torso, 0, oy);
    set('head', PUNCH_WIND.head, 0, oy);
    set('armF', PUNCH_WIND.armF, 0, oy);
    return;
  }
  for (const k of PUNCH_PARTS) set(k, PUNCH_STRIKE[k], 0, oy);
  X.part = 'armF';
  setGlyph(X, PUNCH_FIST, 0, oy);
  if (actT < WHOOSH_T1) setGlyph(W, PUNCH_WHOOSH, 0, oy);
  if (actT >= PUNCH_T.strike) recover((actT - PUNCH_T.strike) / (PUNCH_T.end - PUNCH_T.strike), actT >= PUNCH_T.swap);
}

// Layer 3, kick: the whole body except the head, which stays where locomotion put it.
function kick(actT, ground) {
  if (actT < KICK_T.wind) {
    for (const k of KICK_PARTS) set(k, KICK_WIND[k], 0, 0);
    return;
  }
  for (const k of KICK_PARTS) set(k, KICK_STRIKE[k], 0, 0);
  if (!ground) set('legB', KICK_AIR_LEGB, 0, 0);
  P.head.dx += KICK_HEAD_DX;
  X.part = 'legF';
  setGlyph(X, KICK_FOOT, 0, 0);
  if (actT < WHOOSH_T1) setGlyph(W, KICK_WHOOSH, 0, 0);
  if (actT >= KICK_T.strike) recover((actT - KICK_T.strike) / (KICK_T.end - KICK_T.strike), actT >= KICK_T.swap);
}

// Layer 3, hurt: the recoil pose, then back to locomotion.
function hurt(actT) {
  for (const k of PARTS) set(k, HURT[k], 0, 0);
  if (actT >= HURT_T.strike) recover((actT - HURT_T.strike) / (HURT_T.end - HURT_T.strike), actT >= HURT_T.swap);
}

function put(out, f, ch, dx, dy, part, tone, a) {
  out.push({ dx: dx * f + 0, dy: dy + 0, ch: f < 0 ? MIRROR[ch] || ch : ch, part, tone, a });
}

// Out is the direction of (dx, dy) from the centre on screen, `d` screen units long, in cells and rows.
let outDx = 0, outDy = 0;
function outward(dx, dy, d) {
  const len = Math.hypot(dx, 2 * dy);
  if (len < 1e-9) { outDx = 0; outDy = -d / 2; return; }
  outDx = (d * dx) / len;
  outDy = (d * dy) / len;
}

// The dead body: the pop, the scatter, the rest and the fade. Pieces are relative to the body.
function dead(out, f, actT, rm, sa) {
  if (actT >= DEAD_END) return out;
  const a = (actT <= FADE_T ? 1 : (DEAD_END - actT) / (DEAD_END - FADE_T)) * sa;
  if (!rm && actT < POP_T) {
    for (const k of PARTS) put(out, f, HURT[k][0], HURT[k][1], HURT[k][2], k, 'flash', a);
  } else {
    const tau = actT - POP_T;
    for (const k of PARTS) {
      const s = SCATTER[k];
      let dx, dy, air = true;
      if (rm || tau >= s.t1 + s.t2) {
        dx = s.x2; dy = FLOOR; air = false;
      } else if (tau < s.t1) {
        dx = s.x0 + s.vx * tau;
        dy = Math.min(FLOOR, s.y0 + s.vy * tau + (GRAV * tau * tau) / 2);
      } else {
        const u = tau - s.t1;
        dx = s.x1 + s.vx2 * u;
        dy = Math.min(FLOOR, FLOOR + s.vy2 * u + (GRAV * u * u) / 2);
      }
      const ch = k === 'head' ? 'O' : air ? TUMBLE[Math.floor(tau * TUMBLE_RATE) % 4] : '_';
      put(out, f, ch, dx, dy, k, 'body', a);
    }
  }
  // The pop's sparks: 4 '*' flying out diagonally, fading out by 0.25 s.
  if (!rm && actT < SPARK_T) {
    const k = actT / SPARK_T, r = SPARK_R0 + (SPARK_R1 - SPARK_R0) * k;
    for (const sx of SIGNS) for (const sy of SIGNS) put(out, f, '*', sx * r * SPARK_D, (sy * r * SPARK_D) / 2, 'fx', 'fx', 1 - k);
  }
  return out;
}

// Respawn, over whatever pose was drawn from `start` on: each glyph flies in from 3 out along its own
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

// stickPose(state, t, opts, out) → out, with the body's glyphs { dx, dy, ch, part, tone, a } appended
// (stickman spec §3). Pure: never mutates state, no randomness.
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
  const act = ACTS[st.act] === true ? st.act : 'idle';
  const actT = fin(st.actT, 0) > 0 ? st.actT : 0;
  const aim = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, fin(st.aim, 0)));
  const gun = GUN_ART[st.gun] ? st.gun : 'deagle';
  const rm = !!(opts && opts.reducedMotion);
  const phase = fin(opts && opts.phase, 0);
  const tt = fin(t, 0);
  const f = s.facing;
  // Protection: the body's opacity pulses 3 times a second; Reduce Motion holds it at 0.5.
  const sa = st.safe === true ? (rm ? SAFE_RM : SAFE_MID + SAFE_AMP * Math.cos(2 * Math.PI * SAFE_HZ * tt)) : 1;

  if (act === 'dead') return dead(out, f, actT, rm, sa);

  const breath = rm ? 0 : BREATH_H * (1 - Math.cos(2 * Math.PI * (tt / BREATH_PERIOD + phase))) / 2;
  const art = GUN_ART[gun];
  let tone = 'body', a = sa;

  // Roll (layer 3): a ball on the lower two rows, turning once; no gun.
  if (act === 'roll' && actT < ROLL_END) {
    const fr = ROLL[Math.min(3, Math.floor(actT / ROLL_T))];
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c < 3; c++) {
        const ch = fr[r][c];
        put(out, f, ch, ROLL_X[c], r, ch === 'o' ? 'head' : 'torso', 'body', a);
      }
    }
    // The puff where the roll started: behind the body by the distance rolled.
    if (!rm && actT < PUFF_T) put(out, f, '~', -actT * PUFF_V, 1, 'fx', 'fx', 1);
    return out;
  }

  // Layer 1: locomotion, with the front arm carried or aimed. B keeps it for the recover phases.
  locomotion(s, rm, breath);
  const shooting = act === 'shoot';
  const aimed = shooting || st.aimed === true || aim !== 0;
  const k = shooting ? recoil(actT, rm) : 0;
  if (aimed) {
    const c = Math.cos(aim), sn = Math.sin(aim) / 2, sx = SHOULDER.dx, sy = SHOULDER.dy + bodyDy;
    const r = ARM_R - RECOIL * k;
    P.armF.ch = armGlyph(aim);
    P.armF.dx = sx + r * c;
    P.armF.dy = sy + r * sn;
    P.head.dx -= HEAD_RECOIL * k;
  } else {
    carryArm();
  }

  // Layers 2 and 3: punch overlays the upper body; kick and hurt replace the body. While a punch holds
  // its pose the gun is carried at the hip; a kick or a hurt draws no gun. Once the characters switch
  // back, the gun is drawn as before.
  X.ch = null;
  W.ch = null;
  let carried = !aimed, gunOn = true;
  if (act === 'punch' && actT < PUNCH_T.end) {
    copyPose(B, P);
    punch(actT);
    if (actT < PUNCH_T.swap) carried = true;
  } else if (act === 'kick' && actT < KICK_T.end) {
    copyPose(B, P);
    kick(actT, s.ground);
    if (actT < KICK_T.swap) gunOn = false;
  } else if (act === 'hurt' && actT < HURT_T.end) {
    copyPose(B, P);
    hurt(actT);
    if (actT < HURT_T.swap) gunOn = false;
    if (!rm && actT < HURT_T.flash) tone = 'flash';
  }

  for (const name of PARTS) {
    const p = P[name];
    if (p.ch !== null) put(out, f, p.ch, p.dx, p.dy, name, tone, a);
  }
  if (X.ch !== null) put(out, f, X.ch, X.dx, X.dy, X.part, tone, a);

  // The gun: along the aim ray from the hand, or level at the hip when carried.
  const glyphs = art.glyphs;
  if (!gunOn) {
    // No gun over a kick or a hurt.
  } else if (!carried) {
    const c = Math.cos(aim), sn = Math.sin(aim) / 2, sx = SHOULDER.dx, sy = SHOULDER.dy + bodyDy;
    const steep = Math.abs(aim) > STEEP, armCh = armGlyph(aim), back = RECOIL * k;
    for (let i = 0; i < glyphs.length; i++) {
      const r = HAND_R + i - art.hand - back;
      const ch = steep && glyphs[i] !== '°' ? armCh : glyphs[i];
      put(out, f, ch, sx + r * c, sy + r * sn, 'gun', tone, a);
    }
    if (shooting && actT < FLASH_T) {
      const r = MUZZLE_R[gun] - back;
      put(out, f, '*', sx + r * c, sy + r * sn, 'fx', 'fx', 1);
    }
  } else {
    const hx = HIP.dx + P.torso.dx, hy = HIP.dy + P.torso.dy;
    for (let i = 0; i < glyphs.length; i++) put(out, f, glyphs[i], hx + i - art.hand, hy, 'gun', tone, a);
  }
  // The whoosh: 0.05 s at the end of a strike.
  if (W.ch !== null && actT >= WHOOSH_T0) put(out, f, W.ch, W.dx, W.dy, 'fx', 'fx', 1);
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
