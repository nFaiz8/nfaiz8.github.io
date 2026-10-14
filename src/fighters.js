// Remote fighters in the arena (the arena's counterpart of peers.js). Each is a body moved by arena.js's
// own physics with that person's last input, so they run, jump in arcs and land exactly as they do on
// their own screen. A new state is run forward to the present; the difference from where they were
// drawn glides out over ~80 ms, or snaps when it is large. Pure: no DOM, no clocks; times in ms.
import { newBody, stepBody, knock, rolling, ROLL, AIR_JUMPS, COYOTE } from './arena.js';
import { stunOf, regenHp, GUN_BY_CODE, ACT_TIME, MAX_HP, SAFE_TIME, REGEN_AFTER } from './fight.js';

const SILENT = 300; // ms since the last state was sent before their input counts as released
const CORR_TAU = 0.08, AIM_TAU = 0.06; // seconds
const SNAP = 4; // cells and rows as they are: a bigger correction (a respawn, a clamp) snaps; a take-off glides
const AGE_MAX = 150, BASE_SPAN = 2000; // ms
const STEP = 1 / 60;
const NONE = {};
const BULLETS = new Set(['d', 'r', 'n']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const inputOf = (i) => ({ x: (i & 2 ? 1 : 0) - (i & 1 ? 1 : 0), jump: !!(i & 4), down: !!(i & 8), run: !!(i & 16) });
// The absolute angle back to facing and aim (absAngle's inverse).
function facingAim(a, facing) {
  const f = Math.abs(a) < Math.PI / 2 ? 1 : Math.abs(a) > Math.PI / 2 ? -1 : facing;
  const aim = f > 0 ? a : a >= 0 ? Math.PI - a : -Math.PI - a;
  return { facing: f, aim: Math.max(-Math.PI / 2, Math.min(Math.PI / 2, aim)) };
}

export function createFighters({ kindAt, inside = null, offset = { x: 0, y: 0 }, rtt = () => 100 }) {
  const all = new Map();
  const opts = { inside };

  // Run a body forward by ms, in steps of at most 1/60 s.
  function advance(b, ms, input) {
    const n = Math.ceil(ms / 1000 / STEP - 1e-9);
    for (let k = 0; k < n; k++) stepBody(b, ms / 1000 / n, input, kindAt, opts);
  }

  function add(p, now) {
    const hp = num(p.hp) ? p.hp : MAX_HP;
    const F = {
      id: p.id, kills: num(p.kills) ? p.kills : 0, alive: p.alive !== 0 && p.alive !== false,
      // Hurt: regeneration carries on from this hp at once (its delay already passed, as far as we know).
      hp, hurtAt: hp < MAX_HP ? now - REGEN_AFTER * 1000 : -1e9, safeUntil: p.safe ? now + SAFE_TIME * 1000 : 0,
      gun: GUN_BY_CODE[p.w] || 'deagle', ammo: num(p.ammo) ? p.ammo : -1,
      body: null, bits: 0, input: NONE, lastAt: now, corr: { x: 0, y: 0 }, facing: 1, aim: 0, aimTo: 0,
      act: 'idle', actAt: now, actFor: 0, seen: [], ts: null, rollTs: null,
    };
    if (!F.alive) F.act = 'dead';
    all.set(p.id, F);
    if (num(p.x) && num(p.y)) state(F, p, now, true);
    return F;
  }

  // A state {x, y, vx, vy, f, g, i, a, ts}: rebuild the body there and run it on to the present.
  function state(F, m, now, fresh = false) {
    if (!num(m.x) || !num(m.y)) return;
    const i = num(m.i) ? m.i | 0 : 0;
    let age = 0;
    if (num(m.ts)) {
      const d = now - m.ts;
      F.seen = F.seen.filter((s) => now - s.at <= BASE_SPAN);
      F.seen.push({ at: now, d });
      const base = Math.min(...F.seen.map((s) => s.d));
      age = Math.min(AGE_MAX, Math.max(0, d - base + rtt() / 2));
      if (F.ts != null && m.ts <= F.ts) return; // overtaken by a newer state on the way
      F.ts = m.ts;
    }
    const old = F.body, b = newBody(m.x + offset.x, m.y + offset.y);
    b.vx = num(m.vx) ? m.vx : 0;
    b.vy = num(m.vy) ? m.vy : 0;
    b.onGround = !!m.g;
    // Jump held since the last state is no new press; jump that came on with this state is the take-off.
    b.prevJump = !!((old ? F.bits : i) & 4);
    // The air jump: the count, how long ago it was last taken and how long since the ground (as of when
    // this state was sent) carry on from the body as predicted; touching the ground refills the count.
    if (old) {
      b.airJumps = old.airJumps;
      b.airJumpT = old.airJumpT - old.t + age / 1000;
      if (!b.onGround) b.sinceGround = Math.max(0, (old.onGround ? 0 : old.sinceGround) - age / 1000);
    }
    if (b.onGround) b.airJumps = AIR_JUMPS;
    // A jump that came on with this state in the air, within coyote time of the ground, was the ground
    // jump: its vy is in the state already, so it isn't taken again, and never for the air jump. Further
    // from the ground the press is the air jump, and stepBody takes it below as the sender did.
    if (i & 4 && !b.prevJump && !b.onGround && b.sinceGround <= COYOTE) b.prevJump = true;
    // A let-go is in the state's vy already: not cut again.
    b.cut = !(i & 4);
    const facing = m.f < 0 ? -1 : 1;
    // A roll (bit 32): its time so far is counted on the sender's clock from the state where bit 32 came
    // on, so running each state forward by its age never counts that age twice or restarts the roll.
    if (i & 32) {
      if (!(F.bits & 32) || F.rollTs == null) F.rollTs = num(m.ts) ? m.ts : null;
      const old = F.body;
      const t = F.rollTs != null && num(m.ts) ? (m.ts - F.rollTs) / 1000 : old && rolling(old) ? old.rollT : 0;
      if (t < ROLL.time) { b.rollT = Math.max(0, t); b.rollDir = Math.sign(b.vx) || facing; }
    } else F.rollTs = null;
    const input = inputOf(i);
    advance(b, age, input);
    if (F.body && !fresh) {
      const cx = F.body.x + F.corr.x - b.x, cy = F.body.y + F.corr.y - b.y;
      F.corr = Math.hypot(cx, cy) > SNAP ? { x: 0, y: 0 } : { x: cx, y: cy };
    } else F.corr = { x: 0, y: 0 };
    F.body = b;
    F.bits = i;
    F.input = input;
    F.lastAt = now - age; // when it was sent, as far as we can tell: silence counts from there
    F.facing = facing;
    F.aimTo = num(m.a) ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, m.a)) : 0;
    if (fresh) F.aim = F.aimTo;
  }

  function setAct(F, act, now, forMs) { F.act = act; F.actAt = now; F.actFor = forMs; }

  function apply(m, now) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'aw') {
      all.clear();
      if (Array.isArray(m.fighters)) for (const p of m.fighters) if (p && p.id != null) add(p, now);
      return;
    }
    // Entering, also again while still listed (back from away, or out of being popped): always a fresh start,
    // since the sender's ts restarts too.
    if (m.t === 'aj') { if (m.id != null) { all.delete(m.id); add({ ...m, safe: 1 }, now); } return; }
    const F = all.get(m.id);
    if (m.t === 'k' && m.by != null && all.has(m.by) && num(m.kills)) all.get(m.by).kills = m.kills;
    if (!F) return;
    switch (m.t) {
      case 'ax': all.delete(m.id); break;
      case 'a': if (F.alive) state(F, m, now); break;
      case 's': {
        if (GUN_BY_CODE[m.w]) F.gun = GUN_BY_CODE[m.w];
        if (num(m.a)) { const fa = facingAim(m.a, F.facing); F.facing = fa.facing; F.aim = F.aimTo = fa.aim; }
        F.safeUntil = 0;
        setAct(F, 'shoot', now, ACT_TIME.shoot * 1000);
        break;
      }
      case 'w': if (GUN_BY_CODE[m.w]) { F.gun = GUN_BY_CODE[m.w]; if (num(m.ammo)) F.ammo = m.ammo; } break;
      case 'mm': {
        const kind = m.k === 'k' ? 'kick' : 'punch';
        F.safeUntil = 0;
        setAct(F, kind, now, ACT_TIME[kind] * 1000);
        break;
      }
      case 'h': {
        const stun = stunOf(m.w) || 0;
        if (F.body && num(m.kx) && num(m.ky)) knock(F.body, m.kx, m.ky, stun, BULLETS.has(m.w));
        if (num(m.hp)) F.hp = m.hp;
        F.hurtAt = now;
        if (F.alive) setAct(F, 'hurt', now, stun * 1000);
        break;
      }
      case 'k': F.alive = false; F.hp = 0; F.input = NONE; setAct(F, 'dead', now, Infinity); break;
      case 'sp': {
        if (!num(m.x) || !num(m.y)) break;
        F.body = newBody(m.x + offset.x, m.y + offset.y);
        F.corr = { x: 0, y: 0 };
        F.bits = 0;
        F.rollTs = null;
        F.input = NONE;
        F.lastAt = now;
        F.alive = true;
        F.hp = MAX_HP;
        F.hurtAt = -1e9;
        F.safeUntil = now + SAFE_TIME * 1000;
        setAct(F, 'idle', now, 0);
        break;
      }
    }
  }

  function step(dt, now) {
    if (!(dt > 0)) return;
    const n = Math.ceil(dt / STEP - 1e-9), h = dt / n;
    const kc = Math.exp(-dt / CORR_TAU), ka = 1 - Math.exp(-dt / AIM_TAU);
    for (const F of all.values()) {
      if (!F.body) continue;
      const input = !F.alive || now - F.lastAt > SILENT ? NONE : F.input;
      for (let k = 0; k < n; k++) stepBody(F.body, h, input, kindAt, opts);
      F.corr.x *= kc;
      F.corr.y *= kc;
      F.aim += (F.aimTo - F.aim) * ka;
    }
  }

  function actOf(F, now) {
    if (!F.alive) return { act: 'dead', actT: (now - F.actAt) / 1000 };
    if (rolling(F.body)) return { act: 'roll', actT: F.body.rollT };
    if (F.act !== 'idle' && now - F.actAt <= F.actFor) return { act: F.act, actT: (now - F.actAt) / 1000 };
    return { act: 'idle', actT: 0 };
  }

  function list(now) {
    const out = [];
    for (const F of all.values()) {
      if (!F.body) continue; // joined, but no state yet: nowhere to draw them
      const b = F.body, { act, actT } = actOf(F, now);
      const hp = F.alive ? regenHp(F.hp, F.hurtAt / 1000, now / 1000) : 0;
      out.push({ id: F.id, kills: F.kills, alive: F.alive, state: {
        x: b.x + F.corr.x, y: b.y + F.corr.y, vx: b.vx, vy: b.vy, facing: F.facing, ground: b.onGround, flipT: b.t - b.airJumpT,
        aim: F.aim, act, actT, hp, safe: now < F.safeUntil, gun: F.gun, aimed: F.aimTo !== 0, // the smoothed aim only nears 0
      } });
    }
    return out;
  }

  return {
    apply(m, now) { try { apply(m, now); } catch { /* a malformed message is ignored */ } },
    step,
    list,
    get: (id) => all.get(id) || null,
    ids: () => [...all.keys()],
    clear() { all.clear(); },
  };
}
