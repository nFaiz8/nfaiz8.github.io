// The fight's visual effects as glyph lists: bullets, sparks, damage numbers, hp bars, pickups, sniper aim lines.
// Pure: no DOM, no randomness. Positions in and out are map cells; offset is map minus arena-local.
import { GUNS, MAX_HP, rayLength, bulletRange, bulletAt, bulletGlyphs, along, muzzleOf, absAngle, sweep, inDodge, hurtOf } from './fight.js';
import { GUN_ART } from './stick.js';

const SPARK_COLOR = [255, 214, 140];
const BAR_COLOR = [255, 110, 70];
const PICKUP_COLOR = [255, 236, 210];
const FLASH = [255, 255, 255]; // a headshot's number, in the figures' flash white
const SPARK_ART = [{ ch: '*', ang: -Math.PI / 2 }, { ch: '+', ang: Math.PI / 6 }, { ch: '·', ang: Math.PI * 5 / 6 }];
const SPARK_TIME = 0.25, SPARK_STILL = 0.2, SPARK_REACH = 1.5, NUMBER_TIME = 0.6, HEAD_TIME = NUMBER_TIME * 1.3;
const whiten = (c) => c.map((v) => Math.round((v + 255) / 2));
// Rows above a body's centre: its hp bar (a row over its name, which figures.js puts 2.2 up), and its damage
// numbers a row over the bar, rising from there, so they never share a row with the name or the bar.
const BAR_DY = 3.2, NUMBER_DY = BAR_DY + 1;

export function createFx({ kindAt, offset = { x: 0, y: 0 }, reducedMotion = false }) {
  let bullets = [];
  let sparks = [];
  let numbers = [];
  const local = (x, y) => ({ x: x - offset.x, y: y - offset.y });

  // long: fired crouched or prone, so it flies LOW_RANGE times as far (crouch addendum §3).
  function shot({ id, n, x, y, angle, gun, color, mine, at, long = false }) {
    const l = local(x, y), range = bulletRange(gun, long);
    const end = Math.min(rayLength(kindAt, l.x, l.y, angle, range), range);
    bullets.push({ id, n, x, y, angle, gun, color, mine, t0: at / 1000, end, last: at / 1000 });
  }

  function assign(n) {
    const b = bullets.find((q) => q.mine && q.n == null);
    if (b) b.n = n;
  }

  // A round parried (parry addendum §1): bullet n stops, n2 flies on from the parry point, with a spark and
  // parry! in flash white.
  function parry({ n, n2, x, y, angle, gun, id, color, mine, at }) {
    bullets = bullets.filter((b) => b.n == null || b.n !== n);
    shot({ id, n: n2, x, y, angle, gun, color, mine, at });
    sparks.push({ x, y, t0: at / 1000 });
    numbers.push({ x, y: y - NUMBER_DY, text: 'parry!', t0: at / 1000, life: HEAD_TIME, color: FLASH });
  }

  // hs: a headshot: -50! in flash white, lasting 1.3 times as long.
  function hit({ n, x, y, d, at, hs = false }) {
    bullets = bullets.filter((b) => b.n == null || b.n !== n);
    sparks.push({ x, y, t0: at / 1000 });
    numbers.push(hs
      ? { x, y: y - NUMBER_DY, text: `-${d}!`, t0: at / 1000, life: HEAD_TIME, color: FLASH }
      : { x, y: y - NUMBER_DY, text: `-${d}`, t0: at / 1000, life: NUMBER_TIME, color: SPARK_COLOR });
  }

  function step(dt, nowMs, bodies = []) {
    const now = nowMs / 1000;
    sparks = sparks.filter((s) => now - s.t0 <= SPARK_TIME);
    numbers = numbers.filter((q) => now - q.t0 < q.life);
    bullets = bullets.filter((b) => {
      const reach = GUNS[b.gun].speed;
      if (now - b.t0 >= b.end / reach) return false;
      if (b.mine && now > b.t0) {
        const a = bulletAt(b, Math.max(b.last, b.t0));
        const z = bulletAt(b, Math.min(now, b.t0 + b.end / reach));
        for (const o of bodies) {
          if (o.id === b.id || !o.state || o.state.act === 'dead' || o.state.safe) continue;
          if (o.state.act === 'roll' && inDodge(0, o.state.actT)) continue; // inside its dodge window: it flies on
          const H = hurtOf(o.state.low), c = { x: o.state.x, y: o.state.y + H.dy }; // the stance's box
          if (sweep(a, z, c, c, H.hw, H.hh) >= 0) return false;
        }
      }
      b.last = now;
      return true;
    });
  }

  function glyphs(nowMs, { bodies = [], pickups = [], aims = [] } = {}, out = []) {
    const now = nowMs / 1000;
    const tmp = [];
    for (const b of bullets) {
      const run = Math.min(b.end, GUNS[b.gun].speed * (now - b.t0));
      if (run < 0 || run >= b.end) continue;
      const color = whiten(b.color);
      for (const g of bulletGlyphs(b.gun, b.angle, tmp)) {
        const back = Math.max(0, run - g.du);
        const p = along(b.angle, back);
        out.push({ x: b.x + p.dx, y: b.y + p.dy, ch: g.ch, color, a: g.a, glow: true }); // tracers light the train
      }
    }
    const life = reducedMotion ? SPARK_STILL : SPARK_TIME;
    for (const s of sparks) {
      if (now - s.t0 > life) continue;
      const k = Math.max(0, (now - s.t0) / life);
      for (const p of SPARK_ART) {
        const d = reducedMotion ? { dx: 0, dy: 0 } : along(p.ang, SPARK_REACH * k * 2);
        out.push({ x: s.x + d.dx, y: s.y + d.dy, ch: p.ch, color: SPARK_COLOR, a: 1 - k, glow: true });
      }
    }
    for (const q of numbers) {
      if (now - q.t0 >= q.life) continue;
      const k = Math.max(0, (now - q.t0) / q.life);
      const y = reducedMotion ? q.y : q.y - k;
      for (let i = 0; i < q.text.length; i++) {
        out.push({ x: q.x + i - (q.text.length - 1) / 2, y, ch: q.text[i], color: q.color, a: 1 - k });
      }
    }
    for (const o of bodies) {
      const s = o.state;
      if (!s || s.hp == null || s.hp >= MAX_HP || s.act === 'dead') continue;
      const full = Math.max(0, Math.min(5, Math.ceil(s.hp / 20)));
      for (let i = 0; i < 5; i++) out.push({ x: s.x + i - 2, y: s.y - BAR_DY, ch: i < full ? '█' : '░', color: BAR_COLOR, a: 1 });
    }
    for (const p of pickups) {
      const art = GUN_ART[p.gun].glyphs;
      const bob = p.there && !reducedMotion ? 0.15 * Math.sin(2 * Math.PI * now / 1.5) : 0;
      for (let i = 0; i < art.length; i++) {
        out.push({ x: p.x + i - (art.length - 1) / 2, y: p.y - 0.5 + bob, ch: p.there ? art[i] : '·', color: PICKUP_COLOR, a: p.there ? 1 : 0.35 });
      }
    }
    for (const q of aims) {
      const angle = absAngle(q.facing, q.aim);
      const m = muzzleOf(q.x, q.y, q.facing, q.aim, 'sniper', q.low || 0);
      const l = local(m.x, m.y);
      const len = rayLength(kindAt, l.x, l.y, angle, bulletRange('sniper', !!q.low)); // as far as the shot would go
      for (let r = 2; r < len; r += 2) {
        const d = along(angle, r);
        out.push({ x: m.x + d.dx, y: m.y + d.dy, ch: '·', color: q.color, a: q.ready ? 0.5 : 0.25 });
      }
    }
    return out;
  }

  function clear() {
    bullets = [];
    sparks = [];
    numbers = [];
  }

  return { shot, assign, parry, hit, step, glyphs, clear };
}
