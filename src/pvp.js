// My own fight in the arena: controls into body input and acts, shots, strikes and rolls, the server's
// messages, the practice dummy and offline play (a local referee), and what the HUD shows. DOM-free glue:
// every rule comes from fight.js or the referee. Positions are map cells here and arena-local on the
// wire; times are ms here and seconds in the rules.
import { newBody, stepBody, knock, rolling, doorZone, climbLook, ladderAt } from './arena.js';
import { levelKind } from './level.js';
import {
  MAX_HP, SAFE_TIME, RESPAWN_TIME, GUNS, GUN_BY_CODE, STRIKES, ACT_TIME, stunOf, keyAim, pointAim,
  absAngle, shoulderOf, muzzleOf, regenHp, nextStrike, strikeReady, nearPickup, LOW_KNOCK, CRAWL_SPREAD, sprayOf,
  REGEN_AFTER, PICKUP_BY_CODE,
} from './fight.js';
import { createReferee, newFighter } from './referee.js';
import { createFighters } from './fighters.js';
import { createFx } from './fx.js';
import { flipCut, SHOULDER } from './stick.js';
import { arenaTicker } from './live.js';
import { enterSide } from './world.js';

const DUMMY = 'dummy';
const DUMMY_COL = 50; // the dummy stands on car A's floor here, unless the level says (parseMap)
const FLASH_MS = 110; // a muzzle flash lights the train this long
// Where a body stands on the lowest floor under column c (arena-local): the dummy's spot, from the level.
export function floorSpot(level, c) {
  const at = (r) => level.cells[r * level.cols + c];
  let r = level.rows - 1;
  while (r > 0 && !at(r)) r--; // up through the air under the floor
  while (r > 0 && at(r - 1)) r--; // up to the floor's top
  return { x: c + 0.5, y: r - 1.5 };
}
const DUMMY_COLOR = [150, 150, 150];
const DUMMY_BACK = 2000; // ms after the connection drops before the dummy shows
const PK_EVERY = 500, RS_EVERY = 1000; // ms
const SHAKE = { time: 0.15, amp: 0.4 }; // kicked or popped
const HEAD_SHAKE = { time: 0.1, amp: 0.2 }; // my bullet landed a headshot
const AIM_WARN = 0.3; // s: a sniper's aim line brightens this long before its next shot is ready
const MAX_PRESSES = 4; // strike presses handled in one frame
const IDLE = { x: 0, y: 0, run: false, jump: false, down: false };
const BULLETS = new Set(['d', 'r', 'n']);

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const r2 = (v) => Math.round(v * 100) / 100 + 0; // + 0 turns -0 into 0
const sec = (ms) => ms / 1000;

export function createPvp({
  world, map, level, send = () => false, rtt = () => 100, colorOf = () => [200, 200, 200], nameOf = () => '',
  onNote = () => {}, onFeed = () => {}, onImpact = () => {}, reducedMotion = false, rand = Math.random, myId = () => 'me',
}) {
  const off = { x: map.arena.x + 1, y: map.arena.y + 1 };
  const DUMMY_SPOT = floorSpot(level, Number.isInteger(level.dummy) ? level.dummy : DUMMY_COL);
  const door = doorZone(level, off); // nobody collides in the doorway
  const fighters = createFighters({ kindAt: world.kindAt, inside: world.inside, offset: off, rtt, door, me: (now) => myBox(now), ladders: world.ladders, steps: world.steps });
  const fx = createFx({ kindAt: levelKind(level), offset: off, reducedMotion });
  // My own referee: my cap, ammo and combo always, and offline the whole fight (the dummy too). Online the
  // dummy lives in a second one, against a stand-in of me, so its hits never touch what the server owns.
  const ref = createReferee({ level, rand });
  const practice = createReferee({ level, rand });
  const me = newFighter(myId() || 'me', 0);
  const ghost = newFighter(me.id, 0);
  const dummy = { body: null, rec: null, act: null, deadAt: 0 };
  // The pickups (the level's guns, then a medkit): where each is (arena-local) and when it's back (ms). The
  // referee picks the spots (pickups addendum): offline mine, online the server's (aw, pk).
  const spots = ref.pickups(0).map((q) => ({ n: q.n, kind: PICKUP_BY_CODE[q.g], x: q.x, y: q.y }));
  const taken = spots.map(() => -Infinity);
  function pickupsFromRef(now) {
    for (const q of ref.pickups(sec(now))) { taken[q.n] = now + q.at; spots[q.n].x = q.x; spots[q.n].y = q.y; }
  }
  // A pk or an aw entry: back in at ms, at (x, y) if given.
  function setPickup(q, now) {
    if (!q || !pickOk(q.n) || !num(q.at)) return;
    taken[q.n] = now + q.at;
    if (num(q.x) && num(q.y)) { spots[q.n].x = q.x; spots[q.n].y = q.y; }
  }
  const shotAt = new Map(); // id -> ms of their last shot (for sniper aim lines)

  let entered = false, online = false, enteredAt = 0, ticker = null;
  let lastF = null, awaitAw = false; // the facing in my last a
  let act = null; // my last act: { act, at, for } in ms
  let aim = 0, aimed = false, bits = 0, urgent = false, wasRolling = false, kills = 0;
  let lastShot = -Infinity, lastPk = -Infinity, lastRs = -Infinity, deadAt = 0;
  let dummyBackAt = 0, dummyUp = false;
  let cutJumpT = null; // the air jump (my body's airJumpT) whose flip a kick, hurt or roll took over

  const isMe = (id) => id != null && id === me.id;
  const name = (id) => (isMe(id) ? 'you' : nameOf(id) || 'someone');
  const local = (x, y) => ({ x: x - off.x, y: y - off.y });
  const ts = (now) => Math.max(0, Math.round(now - enteredAt));
  const pickOk = (n) => Number.isInteger(n) && n >= 0 && n < taken.length;
  const shake = (S = SHAKE) => { if (!reducedMotion) world.shake = { until: world.t + S.time, amp: S.amp }; };
  const myHeadshot = (m) => { if (m.hs && isMe(m.by) && !isMe(m.id)) shake(HEAD_SHAKE); };
  // A kill I'm in (I popped someone, the dummy too, or I was popped) freezes the picture a moment (parry
  // addendum §2); a flee hits nobody. Never with Reduce Motion: it is motion, and its flash a strobe.
  // It carries the kill's line, for the picture kept of it (shots.js).
  const impact = (m) => { if (!reducedMotion && !m.fled && (isMe(m.by) || isMe(m.id))) onImpact({ me: isMe(m.id), text: popLine(m) }); };

  // My state for the wire and the local referee (arena-local). The input bits gain 32 rolling, and 64
  // crouched or 128 prone from what my body does (crouch addendum §4), and 512 on a ladder (gorge addendum).
  const lowBits = (p) => (p.low === 2 ? 128 : p.low === 1 ? 64 : 0);
  function snap(now, facing = world.player.facing) {
    const p = world.player, l = local(p.x, p.y);
    return { x: l.x, y: l.y, vx: p.vx, vy: p.vy, f: facing < 0 ? -1 : 1, g: p.onGround ? 1 : 0, i: bits | (rolling(p) ? 32 : 0) | lowBits(p) | (p.climb ? 512 : 0), a: aim, ts: ts(now) };
  }
  // A hit's stun, halved when it landed on a body that was low (lo).
  const stunFor = (m) => (stunOf(m.w) || 0) * (m.lo ? LOW_KNOCK : 1);

  // ---------- bodies colliding (body collision addendum) ----------
  // Which way a goes when its centre is on b's: by id, so both screens agree.
  const tie = (a, b) => (String(a) < String(b) ? -1 : 1);
  // Solid unless dead, protected or rolling (nor when nobody is fighting).
  const mySolid = (now) => entered && me.alive && sec(now) >= me.safeUntil && !rolling(world.player);
  function myBox(now) {
    const p = world.player;
    return { id: me.id, x: p.x, y: p.y, vx: p.vx, vy: p.vy, solid: mySolid(now) };
  }
  const dummyBox = (b = dummy.body) => ({ id: DUMMY, x: b.x, y: b.y, vx: b.vx, vy: b.vy, solid: dummy.rec.alive, tie: tie(me.id, DUMMY) });
  // What my body collides with this frame: the other fighters as drawn, and the dummy.
  function collide(now) {
    if (!entered || !me.alive) return null;
    const others = fighters.boxes(now);
    for (const o of others) o.tie = tie(me.id, o.id);
    if (dummyShown(now)) others.push(dummyBox());
    return { others, solid: mySolid(now), door };
  }

  // ---------- the dummy ----------
  function resetDummy(now) {
    dummy.body = newBody(off.x + DUMMY_SPOT.x, off.y + DUMMY_SPOT.y);
    dummy.rec = newFighter(DUMMY, sec(now));
    ref.enter(dummy.rec, sec(now));
    dummy.rec.safeUntil = 0; // it has nothing to get its bearings for: hittable at once
    dummy.act = null;
    syncDummy(now);
  }
  function syncDummy(now) {
    const b = dummy.body, l = local(b.x, b.y);
    ref.state(dummy.rec, { x: l.x, y: l.y, vx: b.vx, vy: b.vy, f: 1, g: b.onGround ? 1 : 0, i: 0, a: 0 }, sec(now));
  }
  // Shown in the side view whenever no real fighter is known (online: once the welcome said so; not just
  // after a dropped connection).
  function dummyShown(now) {
    const on = entered && !awaitAw && fighters.ids().length === 0 && now >= dummyBackAt;
    if (on && !dummyUp) resetDummy(now);
    dummyUp = on;
    return on;
  }
  const everyone = (now) => (!online && dummyShown(now) ? [me, dummy.rec] : [me]); // who my referee's rules reach

  // Online, the stand-in that shoots and strikes the dummy: me as I am now, endless ammo, the gun in hand.
  function syncGhost(now, facing, gun) {
    Object.assign(ghost, { id: me.id, arena: true, alive: me.alive, gun, ammo: -1, safeUntil: 0, combo: me.combo, strikeAt: me.strikeAt, lastStrike: me.lastStrike, airAt: me.airAt });
    practice.state(ghost, snap(now, facing), sec(now));
  }
  const atDummy = (now) => online && dummyShown(now);

  function dummyMsg(m, now) {
    const b = dummy.body;
    if (m.t === 'h') {
      // Online, local bullet numbers aren't the server's: the bullet already stopped at the dummy on screen.
      fx.hit({ n: online ? undefined : m.n, x: b.x, y: b.y, d: m.d, at: now, hs: !!m.hs });
      myHeadshot(m);
      const stun = stunFor(m);
      if (num(m.kx) && num(m.ky)) knock(b, m.kx, m.ky, stun, BULLETS.has(m.w));
      if (dummy.rec.alive) dummy.act = { act: 'hurt', at: now, for: stun * 1000 };
    } else if (m.t === 'k') dummy.deadAt = now; // quietly: no feed line, no kill
    else if (m.t === 'sp') {
      dummy.body = newBody(off.x + DUMMY_SPOT.x, off.y + DUMMY_SPOT.y);
      dummy.rec.safeUntil = 0;
      dummy.act = null;
    }
  }

  // The ticker's sends, also the states it forces out ahead of a shot.
  function tickerSend(m) {
    const ok = send(m);
    if (ok) lastF = m.f;
    return ok;
  }

  // The local referees' messages: offline all of them, online only what happens to the dummy.
  function runLocal(out, now) {
    for (const m of out) if (!online || m.id === DUMMY) apply(m, now, true);
    me.kills = kills; // the referee credits dummy pops; they never count
  }

  // ---------- messages ----------
  function feed(m) {
    if (!isMe(m.id) && !fighters.get(m.id)) return; // someone already gone: stale
    onFeed(m.fled ? `${name(m.id)} fled from ${name(m.by)}` : popLine(m));
  }
  function popLine(m) {
    const who = (id) => (id === DUMMY ? 'the dummy' : name(id));
    return `${who(m.by)} popped ${who(m.id)}${m.hs ? ' ◎ headshot' : ''}${m.pr ? ' ↩ parry' : ''}`;
  }

  // A round parried (parry addendum §1): drawn back from the parry point, as if sent half my round trip ago.
  function parried(m, now) {
    if (!num(m.x) || !num(m.y) || !num(m.a)) return;
    const mine = isMe(m.id);
    fx.parry({ id: m.id, n: m.n, n2: m.n2, x: m.x + off.x, y: m.y + off.y, angle: m.a, gun: GUN_BY_CODE[m.w] || 'sniper', color: colorOf(m.id), mine, at: now - rtt() / 2 });
    if (mine) shake(HEAD_SHAKE);
  }

  function mineMsg(m, now) {
    const t = sec(now), p = world.player;
    switch (m.t) {
      case 'w': if (GUN_BY_CODE[m.w]) { me.gun = GUN_BY_CODE[m.w]; me.ammo = num(m.ammo) ? m.ammo : -1; } break;
      case 's': if (num(m.n)) fx.assign(m.n); break;
      case 'pk': setPickup(m, now); break;
      case 'hl': {
        if (!me.alive) break;
        if (num(m.hp)) me.hp = m.hp;
        me.hurtAt = Math.max(me.hurtAt, t - REGEN_AFTER); // the regen so far is in hp now: it goes on from here
        if (num(m.d)) fx.heal({ x: p.x, y: p.y, d: m.d, at: now });
        break;
      }
      case 'h': {
        if (!me.alive) break;
        fx.hit({ n: m.n, x: p.x, y: p.y, d: m.d, at: now, hs: !!m.hs });
        if (num(m.hp)) me.hp = m.hp;
        me.hurtAt = t;
        if (m.by != null) me.hitBy = m.by;
        const stun = stunFor(m);
        if (num(m.kx) && num(m.ky)) knock(p, m.kx, m.ky, stun, BULLETS.has(m.w));
        act = { act: 'hurt', at: now, for: stun * 1000 };
        urgent = true;
        if (m.w === 'k') shake();
        break;
      }
      case 'k': {
        feed(m);
        if (m.fled || !me.alive) break;
        Object.assign(me, { alive: false, hp: 0, deadAt: t, gun: 'deagle', ammo: -1 });
        deadAt = now;
        lastRs = -Infinity;
        act = null;
        onNote('popped by ' + (nameOf(m.by) || 'someone'));
        shake();
        break;
      }
      case 'sp': {
        if (!num(m.x) || !num(m.y)) break;
        const facing = p.facing;
        Object.assign(p, newBody(off.x + m.x, off.y + m.y), { facing });
        Object.assign(me, { alive: true, hp: MAX_HP, hurtAt: -1e9, safeUntil: t + SAFE_TIME, hitBy: null, gun: 'deagle', ammo: -1 });
        act = null;
        ref.state(me, snap(now), t);
        break;
      }
    }
  }

  function apply(m, now, isLocal = false) {
    if (!entered || !m || typeof m !== 'object') return;
    if (m.t === 'k') impact(m);
    if (m.t === 'pr') return parried(m, now);
    if (isLocal && m.id === DUMMY) return dummyMsg(m, now);
    if (m.t === 'aw') {
      const you = m.you && typeof m.you === 'object' ? m.you : {};
      if (num(you.hp)) { me.hp = you.hp; me.hurtAt = you.hp < MAX_HP ? sec(now) : -1e9; }
      if (num(you.kills)) kills = me.kills = you.kills;
      if (GUN_BY_CODE[you.w]) { me.gun = GUN_BY_CODE[you.w]; me.ammo = num(you.ammo) ? you.ammo : -1; }
      if (Array.isArray(m.pk)) for (const q of m.pk) setPickup(q, now);
      const list = Array.isArray(m.fighters) ? m.fighters.filter((q) => q && !isMe(q.id)) : [];
      fighters.apply({ ...m, fighters: list }, now);
      awaitAw = false;
      return;
    }
    if (m.t === 'k' && isMe(m.by) && num(m.kills)) kills = me.kills = m.kills;
    if (isMe(m.id)) {
      mineMsg(m, now);
      if (m.t === 'k') fighters.apply(m, now); // the killer's new count
      return;
    }
    const F = fighters.get(m.id);
    switch (m.t) {
      case 'h':
        if (F && F.body) fx.hit({ n: m.n, x: F.body.x + F.corr.x, y: F.body.y + F.corr.y, d: m.d, at: now, hs: !!m.hs });
        myHeadshot(m);
        break;
      case 'k': feed(m); break;
      case 'pk': setPickup(m, now); break;
      case 'hl':
        if (F && F.body && num(m.d)) fx.heal({ x: F.body.x + F.corr.x, y: F.body.y + F.corr.y, d: m.d, at: now });
        break;
      case 's': {
        if (!F || !num(m.x) || !num(m.y) || !num(m.a)) break;
        // Drawn from where it is now: half my round trip after it was fired.
        fx.shot({ id: m.id, n: m.n, x: m.x + off.x, y: m.y + off.y, angle: m.a, gun: GUN_BY_CODE[m.w] || 'deagle', color: colorOf(m.id), mine: false, at: now - rtt() / 2, long: m.l === 1 });
        shotAt.set(m.id, now);
        break;
      }
    }
    fighters.apply(m, now);
  }

  // ---------- controls ----------
  function fire(facing, now) {
    const gun = me.gun, t = sec(now);
    if (now - lastShot < GUNS[gun].cooldown * 1000 - 1e-6) return;
    // A facing the server hasn't heard yet goes out before the shot, or it would find the shot ~6 cells
    // from the muzzle it expects and fire from the other side. It counts against the 20 a a second: with
    // the cap full, the shot waits for the next slot.
    if (online && (facing < 0 ? -1 : 1) !== lastF && !ticker.force(snap(now, facing), now)) return;
    const p = world.player, l = local(p.x, p.y), low = p.low || 0;
    // Crawling (prone is only ever crawling): the shot goes wild, up to CRAWL_SPREAD above the aim. Lying
    // flat, the gun is a hair over the floor: never below level, or the shot dies in the floor at the muzzle.
    // Otherwise a gun with spray (the smg) goes up to its spray off the aim either way, less when crouched.
    const spray = sprayOf(gun, low);
    const shotAim = low === 2 ? Math.max(-Math.PI / 2, Math.min(0, aim) - rand() * CRAWL_SPREAD)
      : spray ? Math.max(-Math.PI / 2, Math.min(Math.PI / 2, aim + (rand() * 2 - 1) * spray)) : aim;
    const mz = muzzleOf(l.x, l.y, facing, shotAim, gun, low); // from the stance's shoulder
    const x = r2(mz.x), y = r2(mz.y), a = r2(absAngle(facing, shotAim));
    ref.state(me, snap(now, facing), t); // this frame's facing, so the muzzle check agrees
    // The referee checks alive, not rolling and the in-flight cap, and spends a pickup gun's round.
    const r = ref.fire(me, { x, y, a }, t, everyone(now));
    if (!r.ok) return;
    lastShot = now;
    act = { act: 'shoot', at: now, for: ACT_TIME.shoot * 1000 };
    fx.shot({ id: me.id, n: null, x: x + off.x, y: y + off.y, angle: a, gun, color: colorOf(me.id), mine: true, at: now, long: low > 0 });
    if (online) {
      send({ t: 'f', x, y, a, ts: ts(now) });
      if (atDummy(now)) { syncGhost(now, facing, gun); runLocal(practice.fire(ghost, { x, y, a }, t, [ghost, dummy.rec]).out, now); }
    }
    runLocal(r.out, now);
  }

  function strike(now) {
    const t = sec(now);
    if (!strikeReady(me, t)) return;
    const { kind } = nextStrike(me, t, !world.player.onGround);
    const k = STRIKES[kind].code;
    ref.state(me, snap(now), t);
    if (atDummy(now)) syncGhost(now, world.player.facing, me.gun); // before my combo moves on
    const r = ref.strike(me, { k }, t, everyone(now));
    if (!r.ok) return;
    act = { act: kind, at: now, for: ACT_TIME[kind] * 1000 };
    if (online) send({ t: 'm', k, ts: ts(now) });
    runLocal(r.out, now);
    if (atDummy(now)) runLocal(practice.strike(ghost, { k }, t, [ghost, dummy.rec]).out, now);
  }

  function control(inp, now) {
    const p = world.player;
    if (!entered || !me.alive) { world.aimFacing = 0; aimed = false; bits = 0; return { ...IDLE }; }
    let facing = p.facing < 0 ? -1 : 1;
    const mouse = inp.mouse && inp.mouse.on && num(inp.mouse.x) && num(inp.mouse.y) ? inp.mouse : null;
    // Ctrl (inp.crouch) is ↓ only where ↓ crouches: on solid floor, off a ladder, so it never drops through
    // a ═ or takes a ladder down.
    const down = !!inp.down || (!!inp.crouch && !!p.onGround && !p.onPlatform && !p.climb && !(world.ladders && ladderAt(p, world.ladders)));
    // Crouching (↓ on solid floor): ↓ doesn't tilt the shot, which stays level (crouch addendum §3).
    const crouching = down && !!p.onGround && !p.onPlatform;
    if (mouse) {
      const s = shoulderOf(p.x, p.y, facing, p.low || 0);
      const r = pointAim(s.x, s.y, mouse.x, mouse.y, facing);
      // Facing turns only once the cursor is past the other shoulder: between the shoulders (aiming
      // straight up or down) it holds, or each turn would put the cursor behind the new shoulder.
      if (Math.abs(mouse.x - p.x) > SHOULDER.dx) facing = r.facing;
      aim = r.aim;
      world.aimFacing = facing;
    } else {
      aim = keyAim(!!inp.aimUp, !!inp.aimDown && !crouching);
      world.aimFacing = 0;
    }
    aimed = !!mouse || !!inp.aimUp || (!!inp.aimDown && !crouching);
    const x = num(inp.x) ? inp.x : 0;
    bits = (x < 0 ? 1 : 0) | (x > 0 ? 2 : 0) | (inp.jump ? 4 : 0) | (down ? 8 : 0) | (inp.run ? 16 : 0) | (inp.up ? 256 : 0);
    if (!rolling(p)) { // a roll drops shots and strikes for its length
      if (inp.fire) fire(facing, now);
      const n = Math.min(MAX_PRESSES, Math.max(0, inp.strikes | 0));
      for (let k = 0; k < n; k++) strike(now);
    }
    return { x, y: num(inp.y) ? inp.y : 0, run: !!inp.run, jump: !!inp.jump, down, up: !!inp.up, roll: inp.roll || 0 };
  }

  // ---------- the frame ----------
  function frame(dt, now) {
    if (!entered) return;
    const t = sec(now), p = world.player;
    const roll = rolling(p);
    if (roll && !wasRolling) urgent = true;
    wasRolling = roll;
    ref.state(me, snap(now), t);
    flipOf(actNow(act, now, me.alive, deadAt, p), p);
    fighters.step(dt, now);
    const on = dummyShown(now);
    if (on && dt > 0) {
      stepBody(dummy.body, dt, IDLE, world.kindAt, { inside: world.inside, door, solid: dummy.rec.alive, others: [{ ...myBox(now), tie: tie(DUMMY, me.id) }] });
      syncDummy(now);
    }
    runLocal(ref.tick(t, everyone(now)), now);
    if (online) runLocal(practice.tick(t, on ? [ghost, dummy.rec] : [ghost]), now);
    fx.step(dt, now, bodies(now));
    if (online && me.alive) { ticker(snap(now), now, urgent); urgent = false; }
    if (me.alive) {
      const l = local(p.x, p.y);
      const full = regenHp(me.hp, me.hurtAt, t) >= MAX_HP;
      for (const q of spots) {
        if (now < taken[q.n] || !nearPickup(l.x, l.y, q) || (q.kind === 'medkit' && full)) continue;
        if (!online) runLocal(ref.pickup(me, q.n, t).out, now);
        else if (now - lastPk >= PK_EVERY) { send({ t: 'pk', n: q.n }); lastPk = now; }
      }
    } else if (now - deadAt >= RESPAWN_TIME * 1000) {
      if (!online) runLocal(ref.respawn(me, t, everyone(now)).out, now);
      else if (now - lastRs >= RS_EVERY) { send({ t: 'rs' }); lastRs = now; }
    }
    if (on && !dummy.rec.alive && now - dummy.deadAt >= RESPAWN_TIME * 1000) runLocal(ref.respawn(dummy.rec, t, [dummy.rec], DUMMY_SPOT).out, now);
    // What my body bumps into on the next step: set every frame, also when no controls ran (away).
    world.collide = collide(now);
  }

  // ---------- what to draw ----------
  function actNow(a, now, alive, diedAt, body) {
    if (!alive) return { act: 'dead', actT: (now - diedAt) / 1000 };
    if (rolling(body)) return { act: 'roll', actT: body.rollT };
    if (a && now - a.at <= a.for) return { act: a.act, actT: (now - a.at) / 1000 };
    return { act: 'idle', actT: 0 };
  }

  // Seconds since my air jump, for the flip; Infinity once a kick, hurt or roll has taken over from it.
  function flipOf(a, p) {
    const flipT = p.t - p.airJumpT;
    if (flipCut(a.act, a.actT, flipT)) cutJumpT = p.airJumpT;
    return p.airJumpT === cutJumpT ? Infinity : flipT;
  }

  function bodies(now) {
    if (!entered) return [];
    const t = sec(now), p = world.player, out = [];
    const a = actNow(act, now, me.alive, deadAt, p), flipT = flipOf(a, p);
    out.push({ id: me.id, me: true, dummy: false, kills, color: colorOf(me.id), state: {
      x: p.x, y: p.y, vx: p.vx, vy: p.vy, facing: p.facing < 0 ? -1 : 1, ground: !!p.onGround, low: p.low || 0, flipT, aim, act: a.act, actT: a.actT, ...climbLook(p),
      hp: me.alive ? regenHp(me.hp, me.hurtAt, t) : 0, safe: me.alive && t < me.safeUntil, combo: me.combo, gun: me.gun, aimed,
    } });
    for (const f of fighters.list(now)) out.push({ id: f.id, me: false, dummy: false, kills: f.kills, color: colorOf(f.id), state: f.state });
    if (dummyShown(now)) {
      const b = dummy.body, R = dummy.rec, d = actNow(dummy.act, now, R.alive, dummy.deadAt, b);
      out.push({ id: DUMMY, me: false, dummy: true, kills: 0, label: 'dummy', color: DUMMY_COLOR, state: {
        x: b.x, y: b.y, vx: b.vx, vy: b.vy, facing: 1, ground: !!b.onGround, low: 0, aim: 0, act: d.act, actT: d.actT,
        hp: R.alive ? regenHp(R.hp, R.hurtAt, t) : 0, safe: false, combo: 0, gun: 'deagle', aimed: false,
      } });
    }
    return out;
  }

  // The pickups as drawn (map cells). Online, none until the welcome says where they are.
  const shownPickups = (now) => (online && awaitAw ? [] : spots.map((q) => ({ n: q.n, kind: q.kind, x: q.x + off.x, y: q.y + off.y, there: now >= taken[q.n] })));

  function glyphs(now, out = []) {
    const list = bodies(now), aims = [];
    for (const b of list) {
      const s = b.state;
      if (s.gun !== 'sniper' || s.act === 'dead') continue;
      const last = b.me ? lastShot : shotAt.has(b.id) ? shotAt.get(b.id) : -Infinity;
      aims.push({ x: s.x, y: s.y, facing: s.facing, aim: s.aim, low: s.low || 0, color: b.color, ready: now - last >= (GUNS.sniper.cooldown - AIM_WARN) * 1000 });
    }
    const pickups = shownPickups(now);
    return fx.glyphs(now, { bodies: list, pickups, aims }, out);
  }

  // Muzzle flashes for the train's light (train level addendum §1): every shot in the last FLASH_MS, at
  // its muzzle, arena-local, k fading from 1.8.
  function flashes(now) {
    const out = [];
    for (const b of bodies(now)) {
      const last = b.me ? lastShot : shotAt.has(b.id) ? shotAt.get(b.id) : -Infinity;
      const age = now - last;
      if (!(age >= 0 && age < FLASH_MS)) continue;
      const s = b.state, mz = muzzleOf(s.x - off.x, s.y - off.y, s.facing, s.aim || 0, s.gun || 'deagle', s.low || 0);
      out.push({ x: mz.x, y: mz.y, k: 1.8 * (1 - age / FLASH_MS) });
    }
    return out;
  }

  function hud(now) {
    const others = fighters.ids().map((id) => fighters.get(id)).filter(Boolean);
    const rows = [{ id: me.id, kills, me: true }, ...others.map((F) => ({ id: F.id, kills: F.kills, me: false }))];
    rows.sort((a, b) => b.kills - a.kills);
    const board = rows.slice(0, 5);
    if (!board.some((r) => r.me)) board.push(rows.find((r) => r.me));
    const hp = me.alive ? Math.max(1, Math.round(regenHp(me.hp, me.hurtAt, sec(now)))) : 0;
    return { hp, gun: me.gun, ammo: me.ammo, alive: me.alive, showBoard: others.length > 0, board };
  }

  // ---------- entering, leaving, the connection ----------
  // A fresh fight for me: full health, SAFE_TIME of protection, the deagle (as the server does on ae).
  function freshFight(now) {
    me.id = myId() || me.id;
    ref.bullets.length = 0;
    practice.bullets.length = 0;
    lastF = null;
    ref.enter(me, sec(now));
    Object.assign(me, { combo: 0, strikeAt: -1e9, lastStrike: null });
    act = null;
    aim = 0; aimed = false; bits = 0; urgent = false; wasRolling = false;
    lastShot = lastPk = lastRs = -Infinity;
    enteredAt = now;
    ticker = arenaTicker(tickerSend);
    ref.state(me, snap(now), sec(now));
  }

  function enter(now, isOnline) {
    entered = true;
    online = !!isOnline;
    fighters.clear(); fx.clear(); shotAt.clear();
    world.aimFacing = 0;
    freshFight(now);
    awaitAw = online; // online, whether anyone else is here is the welcome's to say
    if (!online) pickupsFromRef(now); // offline my referee's spots; online the welcome's
    dummyBackAt = now; dummyUp = false;
    dummyShown(now);
    if (online) send({ t: 'ae' });
  }

  function leave(now) {
    if (!entered) return;
    if (online) send({ t: 'al' });
    ref.leave(me, sec(now), [me]);
    ref.bullets.length = 0;
    practice.bullets.length = 0;
    awaitAw = entered = dummyUp = aimed = false;
    fighters.clear(); fx.clear();
    act = null; bits = 0;
    world.aimFacing = 0;
    world.collide = null;
  }

  function setOnline(v, now) {
    v = !!v;
    if (v === online) return;
    if (!entered) { online = v; return; }
    if (!v) {
      const shown = dummyShown(now);
      online = false;
      fighters.clear();
      fx.clear();
      shotAt.clear();
      ref.bullets.length = 0;
      practice.bullets.length = 0;
      awaitAw = false;
      pickupsFromRef(now);
      Object.assign(me, { hp: MAX_HP, hurtAt: -1e9, hitBy: null });
      if (!shown) dummyBackAt = now + DUMMY_BACK;
    } else {
      // A reconnect is a fresh entry, and the server starts a fresh entry at the door: go there the way
      // walking in does, so body, camera and server agree.
      awaitAw = !dummyShown(now); // a dummy already up stays until the welcome says otherwise
      online = true;
      enterSide(world);
      world.aimFacing = 0;
      freshFight(now);
      send({ t: 'ae' });
    }
  }

  return {
    enter, leave, setOnline, control, frame, bodies, glyphs, flashes, hud, pickups: shownPickups,
    onMessage(m, now) {
      try { apply(m, now); } catch (e) { console.warn('pvp: a message was ignored', m && m.t, e); }
    },
    me, dummy, fighters, fx,
    get online() { return online; },
    get entered() { return entered; },
  };
}
