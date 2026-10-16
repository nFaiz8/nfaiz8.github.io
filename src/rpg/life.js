// Who lives in the station (station spec, "Life and props (round 2)"): pigeons on the platform, rats on the track
// bed, and a few commuters waiting for a train that never stops. Pure: no three.js, no DOM. Each creature is a
// small state machine stepped with dt; scene.js and index.js draw them. Seeded, so a run can be replayed.
import { RADIUS, blocked } from './move.js';

const TAU = 2 * Math.PI;
export function rng(seed) {
  let s = (Math.imul(seed + 1, 2654435761) >>> 0) % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const between = (r, a, b) => a + (b - a) * r();
const wrapAngle = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);

// Where they start, on the shipped map. Commuters face the track they wait for: yaw 0 faces south, π north.
export const STATION_LIFE = {
  pigeons: [{ x: 25.2, z: 8.2 }, { x: 31.6, z: 9.9 }, { x: 36.4, z: 7.6 }, { x: 33.5, z: 11.8 }],
  rats: [{ x: 27, track: 0 }, { x: 34, track: 1 }],
  commuters: [
    { x: 27.4, z: 5.9, yaw: Math.PI, color: '#7d8595' }, // cool grey, waiting for the north track
    { x: 33.3, z: 13.0, yaw: -0.7, color: '#949aa6', phone: true }, // pale grey, on the phone, half turned to you
    { x: 38.6, z: 5.8, yaw: Math.PI, color: '#5f9e9a' }, // the teal coat
    { x: 24.5, z: 12.6, yaw: Math.PI / 2, color: '#a5605a', walkTo: { x: 31.5, z: 12.6 } }, // the dusty red, pacing
  ],
};

// A train counts as coming once its tunnel glows, and while it passes.
const trainNear = (train, x, reach) => !!train && (train.phase === 'warn' || (train.phase === 'pass' && Math.abs(train.head - x) < reach));

// Pigeons: peck (the head bobs), hop a little, and flutter off when you come within SCARE or a train comes; they
// come back to the same spot a while later.
export const PIGEON = { scare: 1.5, fly: 1.1, away: [8, 14], land: 0.9, hop: 0.25, roam: 1.1 };

export function createPigeon(home, seed = 0) {
  const r = rng(seed + 101);
  return { home: { ...home }, x: home.x, z: home.z, y: 0, alpha: 1, face: r() < 0.5 ? -1 : 1, state: 'peck', t: between(r, 0.2, 1), peck: false, flap: false, dir: 1, from: null, to: null, r };
}

export function stepPigeon(p, dt, { walker, train, reducedMotion = false }) {
  const r = p.r;
  p.t -= dt;
  const near = walker && Math.hypot(walker.x - p.x, walker.z - p.z) < PIGEON.scare;
  if ((p.state === 'peck' || p.state === 'hop') && (near || trainNear(train, p.x, 18))) {
    p.state = 'fly'; p.t = PIGEON.fly; p.peck = false;
    p.dir = walker && walker.x > p.x ? -1 : walker && walker.x < p.x ? 1 : p.face;
    p.face = p.dir;
    p.from = { x: p.x, z: p.z };
  }
  switch (p.state) {
    case 'peck':
      if (p.t <= 0) {
        if (p.peck) { p.peck = false; p.t = between(r, 0.25, 0.9); }
        else if (r() < 0.18) { // a short hop, staying near home
          const a = r() * TAU, d = 0.25 + r() * 0.2;
          let tx = p.x + Math.cos(a) * d, tz = p.z + Math.sin(a) * d * 0.6;
          if (Math.hypot(tx - p.home.x, tz - p.home.z) > PIGEON.roam) { tx = p.home.x; tz = p.home.z; }
          p.from = { x: p.x, z: p.z }; p.to = { x: tx, z: tz };
          if (Math.abs(tx - p.x) > 0.02) p.face = Math.sign(tx - p.x);
          p.state = 'hop'; p.t = PIGEON.hop; p.peck = false;
        } else { p.peck = true; p.t = between(r, 0.15, 0.3); }
      }
      break;
    case 'hop': {
      const k = 1 - Math.max(0, p.t) / PIGEON.hop;
      p.x = p.from.x + (p.to.x - p.from.x) * k; p.z = p.from.z + (p.to.z - p.from.z) * k;
      p.y = 0.12 * Math.sin(Math.PI * k);
      if (p.t <= 0) { p.y = 0; p.state = 'peck'; p.t = between(r, 0.3, 1); }
      break;
    }
    case 'fly': { // up and away, fading out
      const k = 1 - Math.max(0, p.t) / PIGEON.fly;
      p.x = p.from.x + p.dir * 3 * k; p.z = p.from.z - 1.2 * k; p.y = 2.6 * k * (0.6 + 0.4 * k);
      p.alpha = 1 - k * k;
      p.flap = reducedMotion ? true : Math.floor(k * 14) % 2 === 0;
      if (p.t <= 0) { p.state = 'away'; p.alpha = 0; p.t = between(r, PIGEON.away[0], PIGEON.away[1]); }
      break;
    }
    case 'away':
      if (p.t <= 0) {
        const clear = !(walker && Math.hypot(walker.x - p.home.x, walker.z - p.home.z) < 2.5) && !train;
        if (!clear) { p.t = 2; break; }
        p.state = 'land'; p.t = PIGEON.land; p.dir = r() < 0.5 ? -1 : 1; p.face = p.dir;
      }
      break;
    case 'land': { // glides in from the side it faces away from
      const k = 1 - Math.max(0, p.t) / PIGEON.land;
      p.x = p.home.x - p.dir * 2 * (1 - k); p.z = p.home.z - 0.8 * (1 - k); p.y = 2.2 * (1 - k) * (1 - k);
      p.alpha = k;
      p.flap = reducedMotion ? true : Math.floor(k * 12) % 2 === 0;
      if (p.t <= 0) { p.x = p.home.x; p.z = p.home.z; p.y = 0; p.alpha = 1; p.flap = false; p.state = 'peck'; p.t = between(r, 0.5, 1.5); }
      break;
    }
  }
  if (p.state === 'peck' || p.state === 'hop') p.flap = false;
  return p;
}

// Rats: nose about on the track bed, run into the nearest tunnel when a train is about 3 s off (its tunnel glows),
// and come back out a little after it has gone.
export const RAT = { walk: 0.8, run: 7, back: [2, 5], roam: 3 };

export function createRat({ x, track }, map, seed = 0) {
  const r = rng(seed + 202), t = map.tracks[track % map.tracks.length];
  const z = t.z + (track % 2 ? 0.95 : -0.95); // beside the rails, toward the platform's far side
  return { home: x, x, z, track: t, face: 1, state: 'roam', t: between(r, 0.5, 2), target: x, tunnel: 0, walked: 0, r, quiet: 0 };
}

export function stepRat(rat, dt, { train }, map) {
  const r = rat.r, x0 = rat.x;
  rat.t -= dt;
  if (train && (rat.state === 'roam' || rat.state === 'return')) { // a train is coming: run
    rat.state = 'flee';
    rat.tunnel = rat.x < map.cols / 2 ? -1.5 : map.cols + 1.5;
  }
  const toward = (target, speed) => {
    const d = target - rat.x, s = Math.min(Math.abs(d), speed * dt);
    if (Math.abs(d) > 1e-6) rat.face = Math.sign(d);
    rat.x += Math.sign(d) * s;
    return Math.abs(target - rat.x) < 1e-3;
  };
  switch (rat.state) {
    case 'roam':
      if (rat.t > 0) break;
      if (toward(rat.target, RAT.walk)) {
        rat.target = rat.home + between(r, -RAT.roam, RAT.roam);
        rat.t = between(r, 0.6, 2.5); // a pause, sniffing, before the next scurry
      }
      break;
    case 'flee':
      if (toward(rat.tunnel, RAT.run)) { rat.state = 'hidden'; rat.quiet = 0; rat.t = between(r, RAT.back[0], RAT.back[1]); }
      break;
    case 'hidden':
      rat.quiet = train ? 0 : rat.quiet + dt;
      if (rat.quiet > 1 && rat.t <= 0) { rat.state = 'return'; rat.target = rat.home + between(r, -RAT.roam, RAT.roam); }
      break;
    case 'return':
      if (toward(rat.target, RAT.walk * 2.5)) { rat.state = 'roam'; rat.t = between(r, 0.5, 2); }
      break;
  }
  rat.walked += Math.abs(rat.x - x0);
  rat.visible = rat.x > -0.5 && rat.x < map.cols + 0.5;
  return rat;
}

// Commuters: stand mostly still, breathing (rig.js), shift their weight now and then, sometimes turn to look down the
// track, and when a train passes step back from the edge and turn to watch it, then settle. One paces.
export const COMMUTER = { radius: 0.25, walk: 0.9, back: 0.5, step: 1.4, settle: [1, 2.5] };

export function createCommuter(spec, seed = 0) {
  const r = rng(seed + 303);
  return {
    ...spec, home: { x: spec.x, z: spec.z }, x: spec.x, z: spec.z, base: spec.yaw, yaw: spec.yaw, targetYaw: spec.yaw,
    shift: 0, shiftTo: 0, t: between(r, 1, 4), look: 0, speed: 0, walked: 0, state: spec.walkTo ? 'walk' : 'idle',
    leg: 1, aim: spec.walkTo ? { ...spec.walkTo } : null, watching: false, settle: 0, r,
  };
}

// The track a commuter stands nearest to, and which way is away from it.
function nearTrack(c, map) {
  let best = null;
  for (const t of map.tracks) if (!best || Math.abs(t.z - c.home.z) < Math.abs(best.z - c.home.z)) best = t;
  return best;
}

export function stepCommuter(c, dt, { train, walker }, map) {
  const r = c.r, x0 = c.x, z0 = c.z;
  c.t -= dt;
  const passing = !!train && train.phase === 'pass' && Math.max(train.head, train.tail) > 0 && Math.min(train.head, train.tail) < map.cols;
  const track = nearTrack(c, map);
  // A train passing: watch it (turn toward its nose); stand back if it's on your side.
  let goal = null;
  if (passing) {
    c.watching = true; c.settle = between(r, COMMUTER.settle[0], COMMUTER.settle[1]);
    const head = Math.max(-2, Math.min(map.cols + 2, train.head));
    c.targetYaw = Math.atan2(head - c.x, train.track.z - c.z);
    if (train.track === track && !c.walkTo) goal = { x: c.home.x, z: c.home.z + Math.sign(c.home.z - track.z) * COMMUTER.back };
    else goal = { x: c.x, z: c.z }; // stop where you are
  } else if (c.watching) {
    c.settle -= dt;
    goal = { x: c.x, z: c.z };
    if (c.settle <= 0) { c.watching = false; c.targetYaw = c.base; c.t = Math.max(c.t, between(r, 1, 3)); }
  }
  if (!goal) {
    if (c.walkTo) { // pacing between two spots, with a pause at each end
      if (c.state === 'pause' && c.t <= 0) { c.state = 'walk'; c.leg = -c.leg; }
      if (c.state === 'walk') goal = c.leg > 0 ? c.walkTo : c.home;
    } else {
      goal = c.home;
      if (c.t <= 0) { // now and then: shift your weight, or look down the track, or look back
        const roll = r();
        if (c.look) { c.look = 0; c.targetYaw = c.base; c.t = between(r, 3, 7); }
        else if (roll < 0.45) { c.shiftTo = c.shiftTo ? 0 : r() < 0.5 ? -1 : 1; c.t = between(r, 3, 8); }
        else { c.look = r() < 0.5 ? -1 : 1; c.targetYaw = c.base + c.look * (Math.PI / 2 - 0.25); c.t = between(r, 1.5, 3); }
      }
    }
  }
  // Move toward the goal, slowly; never into you.
  let speed = 0;
  if (goal) {
    const dx = goal.x - c.x, dz = goal.z - c.z, d = Math.hypot(dx, dz);
    const top = c.watching ? COMMUTER.step : COMMUTER.walk;
    if (d > 0.01) {
      const ux = dx / d, uz = dz / d;
      const ahead = walker && (walker.x - c.x) * ux + (walker.z - c.z) * uz;
      const side = walker && Math.abs((walker.x - c.x) * uz - (walker.z - c.z) * ux);
      const inTheWay = walker && ahead > 0 && ahead < 0.75 && side < 0.5;
      if (!inTheWay) {
        const s = Math.min(d, top * dt);
        c.x += ux * s; c.z += uz * s; speed = s / dt;
        if (c.state === 'walk' && !c.watching) c.targetYaw = Math.atan2(ux, uz);
      }
    } else if (c.walkTo && c.state === 'walk' && !c.watching) { // there: wait a while, facing your track
      c.state = 'pause'; c.t = between(r, 3, 6);
      c.base = c.targetYaw = track.z > c.z ? 0 : Math.PI;
    }
  }
  c.speed = speed;
  c.walked += Math.hypot(c.x - x0, c.z - z0);
  // Turn and shift on springs.
  const turn = 1 - Math.exp(-dt / (c.watching ? 0.25 : 0.6));
  c.yaw = wrapAngle(c.yaw + wrapAngle(c.targetYaw - c.yaw) * turn);
  c.shift += (c.shiftTo - c.shift) * (1 - Math.exp(-dt / 0.5));
  return c;
}

// You can't walk through people: push the walker out of any commuter it overlaps, unless that would put it in a wall.
export function pushOut(w, people, map, r = COMMUTER.radius) {
  for (const p of people) {
    let dx = w.x - p.x, dz = w.z - p.z;
    const d = Math.hypot(dx, dz), min = RADIUS + r;
    if (d >= min) continue;
    if (d < 1e-6) { dx = 0; dz = 1; } else { dx /= d; dz /= d; }
    const nx = p.x + dx * min, nz = p.z + dz * min;
    if (!blocked(map, nx, nz)) { w.x = nx; w.z = nz; }
    else if (!blocked(map, nx, w.z)) w.x = nx;
    else if (!blocked(map, w.x, nz)) w.z = nz;
  }
  return w;
}
