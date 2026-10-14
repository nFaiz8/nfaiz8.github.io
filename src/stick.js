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

// Acts this file draws so far; anything else is drawn as idle. (Task 7 adds punch, kick, hurt, dead, roll.)
const ACTS = { idle: true, shoot: true };

// One reused scratch pose, so a call allocates nothing beyond the glyphs it pushes.
// Each part is { ch, dx, dy } facing right; ch null means not drawn.
const P = {};
for (const k of PARTS) P[k] = { ch: null, dx: 0, dy: 0 };
// Where locomotion moved the torso: the carried gun and the shoulder move with it.
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

// Layer 1: locomotion fills P and sets bodyDx/bodyDy (stickman spec §3 "Choosing the locomotion pose").
function locomotion(s, t, rm, phase) {
  const breath = rm ? 0 : BREATH_H * (1 - Math.cos(2 * Math.PI * (t / BREATH_PERIOD + phase))) / 2;
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

function put(out, f, ch, dx, dy, part, tone) {
  out.push({ dx: dx * f + 0, dy, ch: f < 0 ? MIRROR[ch] || ch : ch, part, tone, a: 1 });
}

// stickPose(state, t, opts, out) → out, with the body's glyphs { dx, dy, ch, part, tone, a } appended
// (stickman spec §3). Pure: never mutates state, no randomness.
export function stickPose(state, t, opts = {}, out = []) {
  const st = state || {};
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
  const f = s.facing;

  // Layer 1: locomotion.
  locomotion(s, fin(t, 0), rm, phase);
  // Layer 2: the upper-body overlay (shoot here; Task 7 adds punch).
  // Layer 3: whole-body acts (Task 7: kick, hurt, dead, roll, respawn) replace P here.

  const art = GUN_ART[gun];
  const shooting = act === 'shoot';
  const aimed = shooting || st.aimed === true || aim !== 0;
  let k = 0;
  if (aimed) {
    k = shooting ? recoil(actT, rm) : 0;
    const c = Math.cos(aim), sn = Math.sin(aim) / 2, sx = SHOULDER.dx, sy = SHOULDER.dy + bodyDy;
    const r = ARM_R - RECOIL * k;
    P.armF.ch = armGlyph(aim);
    P.armF.dx = sx + r * c;
    P.armF.dy = sy + r * sn;
    P.head.dx -= HEAD_RECOIL * k;
  } else {
    // Carried: the arm is '-' halfway from the shoulder to the hand at the hip.
    P.armF.ch = '-';
    P.armF.dx = (SHOULDER.dx + HIP.dx) / 2 + bodyDx;
    P.armF.dy = (SHOULDER.dy + HIP.dy) / 2 + bodyDy;
  }

  for (const name of PARTS) {
    const p = P[name];
    if (p.ch !== null) put(out, f, p.ch, p.dx, p.dy, name, 'body');
  }

  // The gun: along the aim ray from the hand, or level at the hip when carried.
  const glyphs = art.glyphs;
  if (aimed) {
    const c = Math.cos(aim), sn = Math.sin(aim) / 2, sx = SHOULDER.dx, sy = SHOULDER.dy + bodyDy;
    const steep = Math.abs(aim) > STEEP, armCh = armGlyph(aim), back = RECOIL * k;
    for (let i = 0; i < glyphs.length; i++) {
      const r = HAND_R + i - art.hand - back;
      const ch = steep && glyphs[i] !== '°' ? armCh : glyphs[i];
      put(out, f, ch, sx + r * c, sy + r * sn, 'gun', 'body');
    }
    if (shooting && actT < FLASH_T) {
      const r = MUZZLE_R[gun] - back;
      put(out, f, '*', sx + r * c, sy + r * sn, 'fx', 'fx');
    }
  } else {
    const hx = HIP.dx + bodyDx, hy = HIP.dy + bodyDy;
    for (let i = 0; i < glyphs.length; i++) put(out, f, glyphs[i], hx + i - art.hand, hy, 'gun', 'body');
  }
  return out;
}
