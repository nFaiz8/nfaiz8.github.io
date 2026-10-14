import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stickPose, SHOULDER, MUZZLE_R, GUN_ART, HAND_R, RIG, createMotionMemory } from '../src/stick.js';
import { muzzleOf } from '../src/fight.js';

// The rig (docs/specs/2026-10-14-arena-stickman-rig.md). Work in screen units u: 1 u = a cell width, a row = 2 u.
const base = { x: 10, y: 20, vx: 0, vy: 0, facing: 1, ground: true, aim: 0, act: 'idle', actT: 0, gun: 'deagle', landT: Infinity, spawnT: Infinity };
const pose = (s, t = 0, opts = {}) => stickPose({ ...base, ...s }, t, opts);
const part = (g, p) => g.filter((x) => x.part === p);
const head = (g) => part(g, 'head')[0];
const ASCII = /^[\x20-\x7e═╦╤°]$/;
const LIMBS = ['armB', 'armF', 'legB', 'legF'];
const LEN = { armB: [RIG.upperArm, RIG.foreArm], armF: [RIG.upperArm, RIG.foreArm], legB: [RIG.thigh, RIG.shin], legF: [RIG.thigh, RIG.shin] };
const CARRY = (20 * Math.PI) / 180;

// A sprite's centre in u, and a bone's two ends in u (rot is clockwise from upright, len × RIG.bar is its length).
const at = (g) => ({ x: g.dx, y: 2 * g.dy });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function ends(g) {
  const h = (g.len * RIG.bar) / 2, c = at(g);
  return [{ x: c.x + h * Math.sin(g.rot), y: c.y - h * Math.cos(g.rot) }, { x: c.x - h * Math.sin(g.rot), y: c.y + h * Math.cos(g.rot) }];
}
const bones = (g, p) => part(g, p).filter((x) => x.ch === '|');
const cross = (r, a, b) => (a.x - r.x) * (b.y - r.y) - (a.y - r.y) * (b.x - r.x);

// Each limb's root, joint and tip, checking the two bones meet and keep their lengths.
function skeleton(g, label) {
  const torso = bones(g, 'torso');
  assert.equal(torso.length, 1, `one torso bone in ${label}`);
  const out = { torso: ends(torso[0]) };
  for (const limb of LIMBS) {
    const b = bones(g, limb);
    assert.equal(b.length, 2, `${limb}: two bones in ${label}`);
    const [u, l] = b.map(ends);
    let best = null;
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) if (!best || dist(u[i], l[j]) < best.d) best = { d: dist(u[i], l[j]), i, j };
    assert.ok(best.d < 1e-6, `${limb}: the bones meet in ${label} (${best.d})`);
    assert.ok(Math.abs(dist(u[0], u[1]) - LEN[limb][0]) < 1e-6, `${limb}: upper bone length in ${label}`);
    assert.ok(Math.abs(dist(l[0], l[1]) - LEN[limb][1]) < 1e-6, `${limb}: lower bone length in ${label}`);
    out[limb] = { root: u[1 - best.i], joint: u[best.i], tip: l[1 - best.j] };
  }
  return out;
}

// Locomotion, aiming and every act, sampled across their time ranges (facing right).
const SAMPLES = [];
for (let t = 0; t < 2.4; t += 0.3) SAMPLES.push([{}, t]);
for (let x = 0; x < 12; x += 0.75) SAMPLES.push([{ vx: 30, x }], [{ vx: 45, x, gun: 'rifle' }], [{ vx: -30, x }], [{ vx: 6, x }]);
for (let vy = -24; vy <= 24; vy += 3) SAMPLES.push([{ ground: false, vy }], [{ ground: false, vy, gun: 'sniper' }]);
for (let landT = 0; landT < 0.15; landT += 0.02) SAMPLES.push([{ landT }], [{ landT, vx: 30, x: 3 }]);
for (let aim = -Math.PI / 2; aim <= Math.PI / 2 + 1e-9; aim += Math.PI / 8) {
  for (const actT of [0, 0.02, 0.1, 0.2]) SAMPLES.push([{ act: 'shoot', actT, aim, gun: 'rifle' }]);
  SAMPLES.push([{ aimed: true, aim, vx: 30, x: 5 }]);
}
for (let actT = 0; actT < 0.3; actT += 0.01) SAMPLES.push([{ act: 'punch', actT }], [{ act: 'punch', actT, vx: 30, x: 4, gun: 'sniper' }]);
for (let actT = 0; actT < 0.45; actT += 0.01) SAMPLES.push([{ act: 'kick', actT }], [{ act: 'kick', actT, ground: false, vy: 5 }]);
for (let actT = 0; actT < 0.4; actT += 0.01) SAMPLES.push([{ act: 'hurt', actT }], [{ act: 'hurt', actT, ground: false, vy: -20 }]);
for (let actT = 0; actT < 0.35; actT += 0.01) SAMPLES.push([{ act: 'roll', actT }]);
const label = ([s, t]) => `${JSON.stringify(s)} t=${t || 0}`;

test('purity: same input, same output; state untouched; no Math.random; out is appended to and returned', () => {
  const s = { ...base, vx: 30, x: 14.2, act: 'shoot', actT: 0.02, aim: 0.4 };
  const copy = structuredClone(s);
  assert.deepEqual(stickPose(s, 1.23, { phase: 0.3 }), stickPose(s, 1.23, { phase: 0.3 }));
  assert.deepEqual(s, copy);
  assert.doesNotMatch(fs.readFileSync(new URL('../src/stick.js', import.meta.url), 'utf8'), /Math\.random/);
  const mark = { mark: 1 }, out = [mark];
  assert.equal(stickPose(s, 0, {}, out), out);
  assert.equal(out[0], mark);
  assert.deepEqual(out.slice(1), stickPose(s, 0, {}));
});

test('entries: every sprite has rot, len and flip; printable glyphs; head O and bones |, inside the 3-row box', () => {
  for (const smp of SAMPLES) {
    const g = pose(smp[0], smp[1]);
    assert.ok(head(g), label(smp));
    for (const x of g) {
      assert.ok(Number.isFinite(x.rot) && x.len > 0 && typeof x.flip === 'boolean', `${x.part} ${x.ch} in ${label(smp)}`);
      assert.match(x.ch, ASCII);
      if (x.part === 'gun' || x.part === 'fx') continue;
      assert.equal(x.ch, x.part === 'head' ? 'O' : '|');
      assert.ok(Math.abs(x.dx) <= 2.5 && x.dy >= -1.5 && x.dy <= 1.5, `${x.part} at ${x.dx},${x.dy} in ${label(smp)}`);
    }
    for (const x of part(g, 'head')) assert.equal(x.rot, 0);
    for (const x of part(g, 'fx')) assert.equal(x.rot, 0);
  }
});

test('connected skeleton: in every pose the limbs meet at joints, start at S or H, and keep their lengths', () => {
  for (const smp of SAMPLES) {
    const k = skeleton(pose(smp[0], smp[1]), label(smp));
    assert.ok(dist(k.armB.root, k.armF.root) < 1e-6, `both arms start at S in ${label(smp)}`);
    assert.ok(dist(k.legB.root, k.legF.root) < 1e-6, `both legs start at H in ${label(smp)}`);
    assert.ok(Math.min(...k.torso.map((e) => dist(e, k.legF.root))) < 1e-6, `H is the torso's end in ${label(smp)}`);
  }
  // Standing still, S is SHOULDER and the hip is (0, +1 u).
  const k = skeleton(pose({}), 'idle');
  assert.ok(Math.abs(k.armF.root.x - SHOULDER.dx) < 1e-9 && Math.abs(k.armF.root.y - 2 * SHOULDER.dy) < 1e-9);
  assert.ok(Math.abs(k.legF.root.x) < 1e-9 && Math.abs(k.legF.root.y - 1) < 1e-9);
  // The feet stand on the feet line.
  assert.ok(Math.abs(k.legF.tip.y - 2.9) < 0.02 && Math.abs(k.legB.tip.y - 2.9) < 0.02);
});

test('knees and elbows: knees bend forward, elbows back and down', () => {
  for (const smp of SAMPLES) {
    const k = skeleton(pose(smp[0], smp[1]), label(smp));
    for (const limb of ['legB', 'legF']) assert.ok(cross(k[limb].root, k[limb].tip, k[limb].joint) <= 1e-6, `${limb} knee in ${label(smp)}`);
    for (const limb of ['armB', 'armF']) assert.ok(cross(k[limb].root, k[limb].tip, k[limb].joint) >= -1e-6, `${limb} elbow in ${label(smp)}`);
  }
  // Standing, the knee is ahead of the hip-to-foot line and the hanging elbow behind the shoulder-to-hand line.
  const k = skeleton(pose({ landT: 0.02 }), 'land');
  assert.ok(k.legF.joint.x > (k.legF.root.x + k.legF.tip.x) / 2 + 0.05, 'a landing bends the knees forward');
  const r = skeleton(pose({ vx: 30, x: 0.5 }), 'run');
  assert.ok(r.armB.joint.x < (r.armB.root.x + r.armB.tip.x) / 2, 'the back elbow points back');
});

test('the hand holds the gun in every pose that draws one; roll and death draw none', () => {
  let drawn = 0;
  for (const smp of SAMPLES) {
    const g = pose(smp[0], smp[1]), gun = part(g, 'gun');
    if (!gun.length) continue;
    drawn++;
    const name = smp[0].gun || 'deagle';
    assert.equal(gun.map((x) => x.ch).join(''), GUN_ART[name].glyphs, `the gun's own art in ${label(smp)}`);
    const k = skeleton(g, label(smp));
    assert.ok(dist(at(gun[GUN_ART[name].hand]), k.armF.tip) < 0.05, `hand glyph at the forearm's end in ${label(smp)}`);
  }
  assert.ok(drawn > SAMPLES.length * 0.8, `${drawn} of ${SAMPLES.length} poses draw the gun`);
  for (const actT of [0.05, 0.15, 0.25]) assert.equal(part(pose({ act: 'roll', actT, gun: 'rifle' }), 'gun').length, 0);
  for (const actT of [0.04, 0.5]) assert.equal(part(pose({ act: 'dead', actT, gun: 'rifle' }), 'gun').length, 0);
  // Kick and hurt keep the gun in the hand.
  assert.equal(part(pose({ act: 'kick', actT: 0.1, gun: 'sniper' }), 'gun').length, GUN_ART.sniper.glyphs.length);
  assert.equal(part(pose({ act: 'hurt', actT: 0.1, gun: 'sniper' }), 'gun').length, GUN_ART.sniper.glyphs.length);
});

test('carried: at the chest, never at the hip, pointing 20° below level, laid 1 u apart along that line', () => {
  const states = [{}, { vx: 30, x: 2 }, { vx: 45, x: 7 }, { ground: false, vy: -20 }, { ground: false, vy: 3 }, { ground: false, vy: 20 }, { landT: 0.05 }];
  for (const s of states) for (const gun of ['deagle', 'rifle', 'sniper']) {
    const g = part(pose({ ...s, gun }, 0.6), 'gun'), hand = g[GUN_ART[gun].hand], lbl = `${gun} ${JSON.stringify(s)}`;
    assert.ok(hand.dy < 0.1, `the grip above the hip (${hand.dy}) ${lbl}`);
    for (let i = 0; i < g.length; i++) {
      assert.ok(Math.abs(g[i].rot - CARRY) < 1e-9 && g[i].flip === false && g[i].len === 1, lbl);
      const r = i - GUN_ART[gun].hand;
      assert.ok(Math.abs(g[i].dx - hand.dx - r * Math.cos(CARRY)) < 1e-9 && Math.abs(2 * (g[i].dy - hand.dy) - r * Math.sin(CARRY)) < 1e-9, lbl);
    }
  }
  // Standing, a deagle sits wholly above +0.1 rows, in front of the chest.
  const d = part(pose({}), 'gun');
  assert.ok(d.every((x) => x.dy < 0.1) && d[0].dx > 0.3, JSON.stringify(d.map((x) => [x.dx, x.dy])));
  // aimed: true holds it along the aim instead.
  const a = part(pose({ gun: 'rifle', aimed: true }), 'gun');
  assert.ok(a.every((x) => x.rot === 0));
  assert.ok(Math.abs(a[GUN_ART.rifle.hand].dx - (SHOULDER.dx + HAND_R)) < 1e-9);
});

test('aimed: the gun lies along the aim from S + HAND_R, its muzzle at muzzleOf, never swapped for / \\ |', () => {
  for (let k = 0; k <= 16; k++) {
    const aim = -Math.PI / 2 + (k * Math.PI) / 16;
    for (const facing of [1, -1]) for (const gun of ['deagle', 'rifle', 'sniper']) {
      const g = part(pose({ act: 'shoot', actT: 0.2, aim, facing, gun }), 'gun'), art = GUN_ART[gun];
      assert.equal(g.map((x) => x.ch).join(''), art.glyphs, `aim ${aim}`);
      for (let i = 0; i < g.length; i++) {
        const r = HAND_R + i - art.hand;
        assert.ok(Math.abs(g[i].dx - facing * (SHOULDER.dx + r * Math.cos(aim))) < 1e-9, `${gun} glyph ${i} at aim ${aim}`);
        assert.ok(Math.abs(g[i].dy - (SHOULDER.dy + (r * Math.sin(aim)) / 2)) < 1e-9);
        assert.ok(Math.abs(g[i].rot - facing * aim) < 1e-9 && g[i].flip === (facing < 0));
      }
      // The muzzle: half a glyph past the last one, at muzzleOf's point.
      const last = g[g.length - 1], m = muzzleOf(base.x, base.y, facing, aim, gun);
      const mx = last.dx + facing * 0.5 * Math.cos(aim), my = last.dy + (0.5 * Math.sin(aim)) / 2;
      assert.ok(Math.abs(base.x + mx - m.x) < 1e-9 && Math.abs(base.y + my - m.y) < 1e-9, `${gun} muzzle at aim ${aim}`);
    }
  }
});

test('shoot: the flash only for actT < 0.06, at MUZZLE_R less the recoil; the recoil slides hand and gun back 0.3', () => {
  for (const gun of ['deagle', 'rifle', 'sniper']) {
    const flash = part(pose({ act: 'shoot', actT: 0.03, gun }), 'fx')[0];
    assert.equal(flash.ch, '*');
    assert.equal(flash.tone, 'fx');
    // At the drawn gun's muzzle: half a glyph past its last glyph.
    const g = part(pose({ act: 'shoot', actT: 0.03, gun }), 'gun'), last = g[g.length - 1];
    assert.ok(Math.abs(flash.dx - last.dx - 0.5) < 1e-9 && Math.abs(flash.dy - last.dy) < 1e-9);
    assert.equal(part(pose({ act: 'shoot', actT: 0.07, gun }), 'fx').length, 0);
  }
  // The recoil: the hand is HAND_R − 0.3 from the (leaning) shoulder, then HAND_R again.
  const reach = (actT, o = {}) => { const g = pose({ act: 'shoot', actT }, 0, o); return dist(at(part(g, 'gun')[0]), skeleton(g, 'shoot').armF.root); };
  assert.ok(Math.abs(reach(0.02) - (HAND_R - 0.3)) < 1e-9 && Math.abs(reach(0.2) - HAND_R) < 1e-9, 'recoil');
  const hand = (actT) => part(pose({ act: 'shoot', actT }), 'gun')[0].dx;
  const torso = (actT) => bones(pose({ act: 'shoot', actT }), 'torso')[0].rot;
  assert.ok(Math.abs(torso(0.02) + 0.06) < 1e-9 && torso(0.2) === 0, 'the torso leans back 0.06 rad');
  // Reduce Motion: on for 0.08 s, then off, no ease.
  const rm = (actT) => reach(actT, { reducedMotion: true });
  assert.ok(Math.abs(rm(0.07) - (HAND_R - 0.3)) < 1e-9 && Math.abs(rm(0.09) - HAND_R) < 1e-9);
  assert.equal(part(pose({ act: 'shoot', actT: 0.09 }, 0, { reducedMotion: true }), 'gun')[0].dx, hand(0.2));
});

test('mirroring: facing left is facing right with x negated, rot negated and the gun flipped', () => {
  const states = [{}, { vx: 30, x: 14 }, { act: 'shoot', actT: 0.03, aim: -0.5, gun: 'rifle' }, { ground: false, vy: -20 }, { aimed: true, aim: 0.7, gun: 'sniper' },
    { act: 'punch', actT: 0.08 }, { act: 'kick', actT: 0.1, ground: false, vy: 20 }, { act: 'hurt', actT: 0.05 }, { act: 'roll', actT: 0.12 },
    { act: 'dead', actT: 0.04 }, { act: 'dead', actT: 0.5 }, { act: 'dead', actT: 1.6 }, { spawnT: 0.2 }, { spawnT: 0.4 }, { safe: true, vx: 30, x: 14 }];
  const n = (v) => +v.toFixed(9) + 0;
  for (const s of states) {
    const r = pose({ ...s, facing: 1 }, 0.7), l = pose({ ...s, facing: -1, vx: -(s.vx || 0), x: s.x ? -s.x : 10 }, 0.7);
    assert.ok(r.length > 0, JSON.stringify(s));
    assert.deepEqual(l.map((g) => [g.part, n(-g.dx), n(g.dy), n(-g.rot), g.len, g.flip, g.tone, g.a]),
      r.map((g) => [g.part, n(g.dx), n(g.dy), n(g.rot), g.len, g.part === 'gun', g.tone, g.a]), JSON.stringify(s));
    assert.ok(r.every((g) => g.flip === false));
  }
});

// The biggest move of any sprite (by part and order) between two poses, in u; a bar's rot wraps every π.
function jump(a, b) {
  const key = (g) => { const n = {}; return g.filter((x) => x.part !== 'fx').map((x) => { n[x.part] = (n[x.part] || 0) + 1; return [`${x.part}${n[x.part]}`, x]; }); };
  const prev = new Map(key(a));
  let worst = 0;
  for (const [k, x] of key(b)) {
    const p = prev.get(k);
    if (!p) continue;
    worst = Math.max(worst, dist(at(p), at(x)));
  }
  return worst;
}

test('continuity: run, landing and every act sampled every 1 ms never jump a sprite more than 0.35 u (an act may snap at its start)', () => {
  const runs = [
    ['run', 400, (ms) => ({ vx: 30, x: 10 + 0.03 * ms })], ['sprint', 400, (ms) => ({ vx: 45, x: 10 + 0.045 * ms, gun: 'sniper' })],
    ['backwards', 400, (ms) => ({ vx: -30, x: 10 - 0.03 * ms })], ['land', 300, (ms) => ({ landT: ms / 1000 })],
    ['idle', 2400, (ms) => ({})],
  ];
  for (const act of [['punch', 300], ['kick', 450], ['hurt', 400], ['roll', 350], ['shoot', 250], ['dead', 2100]]) {
    runs.push([act[0], act[1], (ms) => ({ act: act[0], actT: ms / 1000, aim: 0.4 })]);
    runs.push([`${act[0]} running`, act[1], (ms) => ({ act: act[0], actT: ms / 1000, vx: 30, x: 10 + 0.03 * ms })]);
    runs.push([`${act[0]} in the air`, act[1], (ms) => ({ act: act[0], actT: ms / 1000, ground: false, vy: -20 + 0.1 * ms })]);
  }
  runs.push(['respawn', 500, (ms) => ({ spawnT: ms / 1000 })]);
  for (const [name, n, at] of runs) {
    let prev = pose(at(0), 0);
    for (let ms = 1; ms <= n; ms++) {
      const cur = pose(at(ms), ms / 1000);
      if (ms > 1) assert.ok(jump(prev, cur) <= 0.35, `${name}: a jump of ${jump(prev, cur).toFixed(3)} u at ${ms} ms`);
      prev = cur;
    }
  }
});

test('continuity: the air pose is one smooth blend in vy', () => {
  let prev = pose({ ground: false, vy: -30 });
  for (let vy = -29.96; vy <= 30; vy += 0.04) {
    const cur = pose({ ground: false, vy });
    assert.ok(jump(prev, cur) < 0.02, `vy ${vy}: ${jump(prev, cur)}`);
    prev = cur;
  }
  // Rise has the arms up by the head, fall has the legs spread.
  const rise = skeleton(pose({ ground: false, vy: -20 }), 'rise'), fall = skeleton(pose({ ground: false, vy: 20 }), 'fall');
  const idle = skeleton(pose({}), 'idle');
  assert.ok(rise.armB.tip.y < -1.5 && rise.armF.tip.y < idle.armF.tip.y, 'arms up');
  assert.ok(fall.legF.tip.x - fall.legB.tip.x > rise.legF.tip.x - rise.legB.tip.x, 'legs spread');
});

test('defaults: {x, y} alone is idle facing right; an unknown act is idle; bad numbers are clamped or zeroed', () => {
  const idle = pose({});
  assert.deepEqual(stickPose({ x: 10, y: 20 }, 0), idle);
  assert.deepEqual(pose({ act: 'dance' }), idle);
  assert.deepEqual(pose({ act: 'shoot', actT: -3, aim: 9 }), pose({ act: 'shoot', actT: 0, aim: Math.PI / 2 }));
});

test('idle breathes by at most 0.06 row; with Reduce Motion it is still', () => {
  const ys = [0, 0.6, 1.2, 1.8].map((t) => head(pose({}, t)).dy);
  assert.ok(Math.max(...ys) - Math.min(...ys) <= 0.06 + 1e-9 && Math.max(...ys) - Math.min(...ys) > 0.03);
  const rm = [0, 0.6, 1.2].map((t) => head(pose({}, t, { reducedMotion: true })).dy);
  assert.ok(rm.every((y) => y === rm[0]));
  // The legs don't breathe.
  assert.deepEqual(part(pose({}, 0.6), 'legF'), part(pose({}, 1.2), 'legF'));
});

test('run: the pose depends only on x (+12 cells is the same), slow is idle, lean forward but not running backwards', () => {
  const r = (g) => g.map((x) => [x.part, +x.dx.toFixed(9), +x.dy.toFixed(9), +x.rot.toFixed(9), +x.len.toFixed(9)]);
  assert.deepEqual(r(pose({ vx: 30, x: 13 })), r(pose({ vx: 30, x: 25 })));
  assert.notDeepEqual(r(pose({ vx: 30, x: 13 })), r(pose({ vx: 30, x: 16 })));
  assert.deepEqual(pose({ vx: 1, x: 13 }), pose({}));
  const lean = (s) => bones(pose(s), 'torso')[0].rot;
  assert.ok(Math.abs(lean({ vx: 30, x: 13 }) - 0.18) < 1e-9);
  assert.ok(Math.abs(lean({ vx: 45, x: 13 }) - 0.26) < 1e-9);
  assert.equal(lean({ vx: -30, x: 13 }), 0);
  // A foot lifts during its swing.
  const feet = [];
  for (let x = 0; x < 12; x += 0.5) feet.push(skeleton(pose({ vx: 30, x }), 'run').legF.tip.y);
  assert.ok(Math.max(...feet) - Math.min(...feet) > 0.5);
});

test('land: the hip and head drop at landT 0.05; at 0.2 it is idle; no squash with Reduce Motion', () => {
  assert.ok(head(pose({ landT: 0.05 })).dy > head(pose({})).dy + 0.05);
  assert.deepEqual(pose({ landT: 0.2 }), pose({}));
  assert.deepEqual(pose({ landT: 0.05 }, 0, { reducedMotion: true }), pose({}, 0, { reducedMotion: true }));
});

test('punch: the fist reaches dx ≥ 1.5 at shoulder height at actT 0.06 and 0.1, not at 0 or 0.3; the legs keep running', () => {
  const fist = (actT) => skeleton(pose({ act: 'punch', actT }), 'punch').armF.tip;
  for (const t of [0.06, 0.1]) assert.ok(fist(t).x >= 1.5 && Math.abs(fist(t).y - 2 * SHOULDER.dy) < 0.3, `${t}: ${JSON.stringify(fist(t))}`);
  assert.ok(fist(0).x < 1.5 && fist(0.3).x < 1.5);
  const run = { vx: 30, x: 14 };
  assert.deepEqual(part(pose({ ...run, act: 'punch', actT: 0.1 }), 'legB'), part(pose(run), 'legB'));
  assert.deepEqual(pose({ act: 'punch', actT: 0.25 }), pose({}));
  // The whoosh, 0.06–0.11 s.
  assert.equal(part(pose({ act: 'punch', actT: 0.08 }), 'fx')[0].ch, ')');
  assert.equal(part(pose({ act: 'punch', actT: 0.12 }), 'fx').length, 0);
});

test('kick: the foot reaches dx ≥ 1.4 at dy ≈ 0.55 at actT 0.06 and 0.15, in the air too; the torso leans back', () => {
  for (const ground of [true, false]) for (const actT of [0.06, 0.15]) {
    const k = skeleton(pose({ act: 'kick', actT, ground, vy: ground ? 0 : 5 }), 'kick');
    assert.ok(k.legF.tip.x >= 1.4 && Math.abs(k.legF.tip.y / 2 - 0.55) < 0.15, `ground ${ground} t ${actT}: ${JSON.stringify(k.legF.tip)}`);
  }
  assert.ok(bones(pose({ act: 'kick', actT: 0.15 }), 'torso')[0].rot < -0.2);
  // A flying kick tucks the back knee.
  const back = (ground) => skeleton(pose({ act: 'kick', actT: 0.15, ground, vy: 5 }), 'kick').legB.tip.y;
  assert.ok(back(false) < back(true) - 0.3);
  assert.deepEqual(pose({ act: 'kick', actT: 0.4 }), pose({}));
});

test('hurt: all white for actT < 0.08, none after; snapped back; locomotion at 0.35; no white with Reduce Motion', () => {
  assert.ok(pose({ act: 'hurt', actT: 0.05 }).every((g) => g.tone === 'flash'));
  assert.ok(pose({ act: 'hurt', actT: 0.1 }).every((g) => g.tone !== 'flash'));
  assert.ok(bones(pose({ act: 'hurt', actT: 0.1 }), 'torso')[0].rot < -0.25);
  assert.ok(head(pose({ act: 'hurt', actT: 0.1 })).dx < head(pose({})).dx - 0.4);
  assert.deepEqual(pose({ act: 'hurt', actT: 0.35 }), pose({}));
  assert.ok(pose({ act: 'hurt', actT: 0.05 }, 0, { reducedMotion: true }).every((g) => g.tone !== 'flash'));
});

test('roll: one forward turn about the ball\'s centre (1.4 u above the floor), tucked low, a puff behind; locomotion after 0.3 s', () => {
  // The head's angle about the pivot (0, +1.6 u) turns once, clockwise on screen (forward, facing right).
  let turned = 0, prev = null;
  for (let ms = 0; ms <= 300; ms++) {
    const h = at(head(pose({ act: 'roll', actT: ms / 1000 })));
    const a = Math.atan2(h.y - 1.6, h.x);
    if (prev !== null) turned += ((a - prev + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    prev = a;
  }
  assert.ok(Math.abs(turned - 2 * Math.PI) < 0.8, `turned ${turned}`);
  for (const t of [0.08, 0.15, 0.22]) assert.ok(pose({ act: 'roll', actT: t }).filter((x) => x.part !== 'fx').every((x) => x.dy >= -0.5), `low at ${t}`);
  const puff = part(pose({ act: 'roll', actT: 0.05 }), 'fx');
  assert.equal(puff.length, 1);
  assert.equal(puff[0].ch, '~');
  assert.ok(Math.abs(puff[0].dx + 2.4) < 1e-9 && puff[0].dy === 1);
  assert.equal(part(pose({ act: 'roll', actT: 0.12 }), 'fx').length, 0);
  assert.equal(part(pose({ act: 'roll', actT: 0.05 }, 0, { reducedMotion: true }), 'fx').length, 0);
  assert.deepEqual(pose({ act: 'roll', actT: 0.3 }), pose({}));
});

test('protection: a 0.35–0.8 pulse that changes over time; steady 0.5 with Reduce Motion', () => {
  const as = [0, 0.05, 0.1, 0.15].map((t) => head(pose({ safe: true }, t)).a);
  assert.ok(as.every((a) => a >= 0.35 - 1e-9 && a <= 0.8 + 1e-9));
  assert.ok(new Set(as.map((a) => a.toFixed(3))).size > 1);
  assert.equal(head(pose({ safe: true }, 0.1, { reducedMotion: true })).a, 0.5);
});

test('dead: the pop is the hurt pose in white with 4 sparks, then the head and nine bones fly, spin and settle flat on the feet line', () => {
  const pop = pose({ act: 'dead', actT: 0.04 });
  assert.equal(part(pop, 'fx').filter((g) => g.ch === '*').length, 4);
  const hurt = pose({ act: 'hurt', actT: 0.1 });
  assert.deepEqual(pop.filter((g) => g.part !== 'fx').map((g) => [g.part, g.dx, g.dy, g.rot, g.len]),
    hurt.filter((g) => g.part !== 'fx' && g.part !== 'gun').map((g) => [g.part, g.dx, g.dy, g.rot, g.len]));
  assert.ok(pop.filter((g) => g.part !== 'fx').every((g) => g.tone === 'flash'));
  assert.equal(part(pose({ act: 'dead', actT: 0.3 }), 'fx').length, 0);
  // Spinning in the air.
  const r1 = bones(pose({ act: 'dead', actT: 0.2 }), 'armB'), r2 = bones(pose({ act: 'dead', actT: 0.25 }), 'armB');
  assert.ok(r1.some((b, i) => Math.abs(b.rot - r2[i].rot) > 0.2), 'tumbling');
  // Settled by 1.2 s: the same until the fade, flat, on the feet line.
  const rest = pose({ act: 'dead', actT: 1.2 });
  assert.equal(rest.length, 10);
  assert.deepEqual(rest.map((g) => [g.dx, g.dy, g.rot]), pose({ act: 'dead', actT: 1.4 }).map((g) => [g.dx, g.dy, g.rot]));
  for (const g of rest) {
    if (g.part === 'head') { assert.equal(g.ch, 'O'); assert.equal(g.rot, 0); continue; }
    assert.ok(Math.abs(Math.abs(g.rot) - Math.PI / 2) < 1e-9, `${g.part} flat`);
    assert.ok(g.dy > 1.3 && g.dy < 1.5, `${g.part} on the feet line (${g.dy})`);
  }
  const xs = rest.map((g) => g.dx);
  assert.ok(Math.max(...xs) - Math.min(...xs) > 4, `spread ${Math.max(...xs) - Math.min(...xs)}`);
  // Never below where they rest.
  const floor = new Map(rest.map((g, i) => [i, g.dy]));
  for (let t = 0.08; t <= 1.2; t += 0.01) pose({ act: 'dead', actT: t }).filter((g) => g.part !== 'fx').forEach((g, i) => assert.ok(g.dy <= floor.get(i) + 1e-9, `${g.part} at ${t}`));
  // The fade, then nothing.
  assert.ok(pose({ act: 'dead', actT: 1.35 }).every((g) => g.a === 1 || g.part === 'fx'));
  assert.ok(pose({ act: 'dead', actT: 1.99 }).every((g) => g.a < 0.05));
  assert.deepEqual(pose({ act: 'dead', actT: 2.01 }), []);
  // Reduce Motion: no pop, no flight: lying flat at once.
  const rm = pose({ act: 'dead', actT: 0.04 }, 0, { reducedMotion: true });
  assert.equal(part(rm, 'fx').length, 0);
  assert.deepEqual(rm.map((g) => [g.dx, g.dy, g.rot]), rest.map((g) => [g.dx, g.dy, g.rot]));
});

test('respawn: invisible at spawnT 0, flies in from 3 out, then white; idle from 0.45; Reduce Motion fades in place', () => {
  assert.ok(pose({ spawnT: 0 }).every((g) => g.a === 0));
  const mid = pose({ spawnT: 0.1 });
  assert.ok(head(mid).dy < head(pose({})).dy - 0.1, 'the head comes in from above');
  assert.ok(pose({ spawnT: 0.4 }).every((g) => g.tone === 'flash' && g.a === 1));
  assert.deepEqual(pose({ spawnT: 0.45 }), pose({}));
  const rm = pose({ spawnT: 0.15 }, 0, { reducedMotion: true });
  assert.deepEqual(rm.map((g) => [g.ch, g.dx, g.dy, g.rot]), pose({}, 0, { reducedMotion: true }).map((g) => [g.ch, g.dx, g.dy, g.rot]));
  assert.ok(rm.every((g) => Math.abs(g.a - 0.5) < 1e-9 && g.tone === 'body'));
  assert.ok(pose({ spawnT: 0.4 }, 0, { reducedMotion: true }).every((g) => g.tone === 'body' && g.a === 1));
});

test('respawn: the fly-in goes over whatever is drawn, the gun as one piece', () => {
  for (const s of [{ act: 'shoot', actT: 0.02, aim: 0.3, gun: 'rifle' }, { act: 'punch', actT: 0.1 }, { act: 'roll', actT: 0.1 }, { vx: 30, x: 14 }]) {
    const flying = pose({ ...s, spawnT: 0.2 }), plain = pose(s);
    assert.deepEqual(flying.map((g) => [g.part, g.ch, g.rot, g.len]), plain.map((g) => [g.part, g.ch, g.rot, g.len]), JSON.stringify(s));
    assert.ok(flying.some((g, i) => dist(at(g), at(plain[i])) > 0.1), 'still flying in');
    assert.ok(flying.every((g) => g.a > 0 && g.a < 1));
  }
  const gun = part(pose({ act: 'shoot', actT: 0.02, aim: 0.3, gun: 'rifle', spawnT: 0.2 }), 'gun');
  const still = part(pose({ act: 'shoot', actT: 0.02, aim: 0.3, gun: 'rifle' }), 'gun');
  const shift = gun.map((g, i) => [+(g.dx - still[i].dx).toFixed(9), +(g.dy - still[i].dy).toFixed(9)]);
  assert.ok(shift.every((d) => d[0] === shift[0][0] && d[1] === shift[0][1]));
});

test('motion memory: landing sets landT 0; dead → idle sets spawnT 0; ids are forgotten after 5 s', () => {
  const m = createMotionMemory();
  const s1 = m.fill('a', { ground: false, act: 'idle' }, 0);
  assert.equal(s1.spawnT, 0, 'first seen');
  assert.equal(s1.landT, Infinity);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 0.1).landT, 0);
  assert.ok(Math.abs(m.fill('a', { ground: true, act: 'idle' }, 0.2).landT - 0.1) < 1e-9);
  m.fill('a', { ground: true, act: 'dead' }, 1);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 3).spawnT, 0);
  assert.equal(m.fill('a', { ground: true, act: 'idle' }, 9).spawnT, 0, 'forgotten after 5 s: seen fresh');
});

test('the shared constants keep their values', () => {
  assert.deepEqual(SHOULDER, { dx: 0.15, dy: -0.3 });
  assert.equal(HAND_R, 1.3);
  assert.deepEqual(MUZZLE_R, { deagle: 2.8, rifle: 4.8, sniper: 6.8 });
  assert.deepEqual(GUN_ART, { deagle: { glyphs: '╦═', hand: 0 }, rifle: { glyphs: '═╦╤══', hand: 1 }, sniper: { glyphs: '═╦═°═══', hand: 1 } });
  assert.deepEqual([RIG.torso, RIG.upperArm, RIG.foreArm, RIG.thigh, RIG.shin], [2, 0.95, 0.95, 1, 1]);
});
