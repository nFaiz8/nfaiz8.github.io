// The station in 3D (station spec §5): lit shapes with faint ASCII painted on them, built from the map.
// Walls, floors, stairs, pillars, benches, turnstiles and the kiosk are instanced unit boxes, one per tile (walls
// stacked a box per unit of height), so the texture repeats once per world unit.
import * as THREE from 'three';
import { LEVEL } from './map.js';
import { makeSprite, PROPS } from './sprites.js';
import { TRAIN } from './train.js';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
export const WALL_HEIGHT = 4; // over the highest floor beside a wall
// Walls this close on the camera's side fade (spec §4). The eye sits cos 35° × 10 ≈ 8.2 south of the focus, plus
// up to ~1 of spring lag, and is lower than the outer walls' tops; a reach shorter than that left the south wall
// solid between the eye and you (a black screen walking north past z ≈ 11.5 on the platform).
const FADE_REACH = 10;
const TUNNEL = 3.4; // a tunnel mouth's height over the track

// A tile texture: a base colour with one faint glyph over it.
function glyphTexture([base, ink, glyph], alpha = 0.35, size = 64) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, size, size);
  g.globalAlpha = alpha; g.fillStyle = ink;
  g.font = `${size * 0.8}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, size / 2, size / 2 + 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const SURF = {
  wall: ['#3a3f4f', '#8d96ad', '┼'], hall: ['#4a4640', '#a49b8a', '·'], platform: ['#3f4148', '#9aa0ad', '·'],
  edge: ['#c9a227', '#3a2f10', '▀'], track: ['#26231f', '#7a6a55', '═'], stair: ['#4b4a50', '#b0b0bc', '─'],
  kiosk: ['#5a2e2a', '#d9a090', '▤'], pillar: ['#55596a', '#a9afc2', '│'], bench: ['#5b4632', '#c49a6c', '═'],
};

export function buildScene(scene, map, { reducedMotion = false } = {}) {
  const SHAKE = { x: 0, y: 0 }; // reused each frame
  const owned = []; // everything to dispose
  const own = (x) => { owned.push(x); return x; };
  scene.background = new THREE.Color('#05060a');
  scene.fog = new THREE.Fog('#05060a', 16, 34);
  scene.add(new THREE.HemisphereLight('#8090b8', '#1a1612', 0.6));

  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const mats = {};
  for (const [k, s] of Object.entries(SURF)) mats[k] = own(new THREE.MeshStandardMaterial({ map: own(glyphTexture(s)), roughness: 0.92, metalness: 0 }));
  const boxes = Object.fromEntries(Object.keys(SURF).map((k) => [k, []]));
  const box = (kind, x, y, z, sx = 1, sy = 1, sz = 1) => boxes[kind].push([x, y, z, sx, sy, sz]);

  const levels = (c, r) => {
    const out = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const n = map.at(c + dc, r + dr); if (n && n.level != null) out.push(n.level); }
    return out;
  };

  // Wall cubes and pillars, kept apart so the ones between the camera and you can fade (spec §4).
  const fading = { wall: [], pillar: [] };
  const fadeBox = (kind, c, r, y, s = 1) => fading[kind].push({ c, r, m: new THREE.Matrix4().compose(new THREE.Vector3(c + 0.5, y + 0.5, r + 0.5), new THREE.Quaternion(), new THREE.Vector3(s, 1, s)) });
  const wallCube = (c, r, y) => fadeBox('wall', c, r, y);
  // The map's outer walls all rise to the highest floor + WALL_HEIGHT: at 35° the camera sees ~15 north of you,
  // and a wall only 4 over the track would let it see over into the void.
  const roof = Math.max(...map.cells.filter((cell) => cell.level != null).map((cell) => cell.level)) + WALL_HEIGHT;
  const edge = (c, r) => c === 0 || r === 0 || c === map.cols - 1 || r === map.rows - 1;
  for (const cell of map.cells) {
    const { c, r, ch } = cell, x = c + 0.5, z = r + 0.5;
    if (ch === '#' || ch === 'n') {
      const ls = levels(c, r);
      if (!ls.length) continue; // buried in other walls
      const lo = Math.min(...ls) - 0.4, top = edge(c, r) ? roof : Math.max(...ls) + WALL_HEIGHT;
      for (let y = lo; y < top - 1e-6; y += 1) wallCube(c, r, y);
      continue;
    }
    if (ch === '=') {
      box('track', x, LEVEL.track - 0.1, z, 1, 0.2, 1);
      // Where a track leaves the map (a tunnel), the end wall carries on over it, so the mouth is a dark opening.
      if (c === 0 || c === map.cols - 1) for (let y = LEVEL.track + TUNNEL; y < roof - 1e-6; y += 1) wallCube(c, r, y);
      continue;
    }
    if (cell.stair) {
      const s = cell.stair;
      const lo = Math.min(s.from ?? 0, s.to ?? 0) - 0.2;
      for (let k = 0; k < 2; k++) { // two treads per tile
        const ax = s.dx ? x + s.dx * (k * 0.5 - 0.25) : x, az = s.dz ? z + s.dz * (k * 0.5 - 0.25) : z;
        // Each tread's top is the ramp's height at its lower (front) edge, so the ramp you walk on never dips
        // under a tread and your feet don't sink into the steps.
        const front = s.dx ? ax + s.dx * 0.25 : ax, frontZ = s.dz ? az + s.dz * 0.25 : az;
        const top = map.levelAt(front - (s.dx > 0 ? 0.001 : s.dx < 0 ? -0.001 : 0), frontZ - (s.dz > 0 ? 0.001 : s.dz < 0 ? -0.001 : 0));
        box('stair', ax, (lo + top) / 2, az, s.dx ? 0.5 : 1, top - lo, s.dz ? 0.5 : 1);
      }
      continue;
    }
    if (cell.level == null) continue;
    const y = cell.level;
    box(ch === '!' ? 'edge' : y === LEVEL.hall ? 'hall' : 'platform', x, y - 0.1, z, 1, 0.2, 1);
    if (ch === '|') for (let k = 0; k < WALL_HEIGHT; k++) fadeBox('pillar', c, r, y + k, 0.6);
    if (ch === 'b') box('bench', x, y + 0.25, z, 0.9, 0.5, 0.5);
    if (ch === 't') box('pillar', x, y + 0.5, z, 0.25, 1, 0.6);
    if (ch === 'k') box('kiosk', x, y + 1.1, z, 1, 2.2, 1);
    if (ch === 'E') { // steps rising toward the wall beside the exit, toward the museum
      const wall = [[-1, 0], [1, 0], [0, -1], [0, 1]].find(([dc, dr]) => map.solidAt(c + dc + 0.5, r + dr + 0.5) && !map.solidAt(c - dc + 0.5, r - dr + 0.5)) || [-1, 0];
      for (let k = 0; k < 3; k++) box('stair', x + wall[0] * (k * 0.3 - 0.3), y + 0.15 * (k + 1), z + wall[1] * (k * 0.3 - 0.3), wall[0] ? 0.3 : 1, 0.3 * (k + 1), wall[1] ? 0.3 : 1);
    }
  }

  const tmp = new THREE.Matrix4();
  for (const [kind, list] of Object.entries(boxes)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(unit, mats[kind], list.length);
    list.forEach(([x, y, z, sx, sy, sz], i) => mesh.setMatrixAt(i, tmp.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(sx, sy, sz))));
    scene.add(mesh);
  }
  // Between the camera and you: south of you, within reach, and within `side` of you across (walls block a wide
  // view; pillars and tubes only fade when they're nearly in line with you).
  const nearCamera = (x, z, w, side = FADE_REACH) => z > w.z + 0.5 && z < w.z + FADE_REACH && Math.abs(x - w.x) < side;
  const fadeSets = Object.entries(fading).filter(([, list]) => list.length).map(([kind, list]) => {
    const fadeMat = own(mats[kind].clone());
    fadeMat.transparent = true; fadeMat.opacity = 0.25; fadeMat.depthWrite = false;
    const solid = new THREE.InstancedMesh(unit, mats[kind], list.length), faded = new THREE.InstancedMesh(unit, fadeMat, list.length);
    // placeWalls moves instances between these two every few steps, and three.js computes an InstancedMesh's
    // bounding sphere once, from the instances it had then; culling against that stale sphere would drop them.
    solid.frustumCulled = faded.frustumCulled = false;
    scene.add(solid, faded);
    return { side: kind === 'wall' ? FADE_REACH : 1.6, list, solid, faded };
  });
  let fadedFor = '';
  const placeWalls = (w) => {
    const key = `${Math.floor(w.x)},${Math.floor(w.z)}`;
    if (key === fadedFor) return;
    fadedFor = key;
    for (const { side, list, solid, faded } of fadeSets) {
      let a = 0, b = 0;
      for (const wl of list) {
        if (nearCamera(wl.c + 0.5, wl.r + 0.5, w, side)) faded.setMatrixAt(b++, wl.m); else solid.setMatrixAt(a++, wl.m);
      }
      solid.count = a; faded.count = b;
      solid.instanceMatrix.needsUpdate = faded.instanceMatrix.needsUpdate = true;
    }
  };

  // Rails along each track.
  const railMat = own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 }));
  for (const t of map.tracks) for (const dz of [-0.72, 0.72]) {
    const rail = new THREE.Mesh(unit, railMat);
    rail.position.set(map.cols / 2, t.y + 0.06, t.z + dz);
    rail.scale.set(map.cols + 8, 0.12, 0.1);
    scene.add(rail);
  }

  // The station's name, on the far wall's face over the tracks.
  const signTex = own(nameTexture(map.name));
  const signMat = own(new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
  const signGeo = own(new THREE.PlaneGeometry(3, 0.75));
  for (const s of map.signs) {
    const m = new THREE.Mesh(signGeo, signMat);
    m.position.set(s.x, LEVEL.track + 2.4, s.z + 0.51);
    scene.add(m);
  }

  // Tubes: a bright bar each (it blooms) and a cool point light under it.
  const tubeGeo = own(new THREE.BoxGeometry(1.4, 0.06, 0.16));
  const tubeMat = own(new THREE.MeshBasicMaterial({ color: '#e8f4ff', toneMapped: false }));
  // A tube between the camera and you would sit right over your head, so it dims and goes see-through.
  const tubeFadeMat = own(new THREE.MeshBasicMaterial({ color: '#e8f4ff', transparent: true, opacity: 0.2, depthWrite: false }));
  const tubes = map.tubes.map((t) => {
    const bar = new THREE.Mesh(tubeGeo, tubeMat);
    bar.position.set(t.x, t.y, t.z);
    const light = new THREE.PointLight('#cfe3ff', 7, 8, 1.6);
    light.position.set(t.x, t.y - 0.25, t.z);
    scene.add(bar, light);
    return { ...t, bar, light, base: 7 };
  });

  // The way back up: warm light over the exit, and a sign.
  if (map.exits.length) {
    const mid = map.exits[Math.floor(map.exits.length / 2)];
    const y = map.levelAt(mid.x, mid.z) ?? 0;
    const warm = new THREE.PointLight('#ffb35c', 10, 6, 1.8);
    warm.position.set(mid.x, y + 2.4, mid.z);
    const up = makeSprite(['▲ MUSEUM'], '#ffce6e', 0.5, { glow: true });
    up.mesh.position.set(mid.x + 0.6, y + 2.3, mid.z);
    owned.push(up);
    scene.add(warm, up.mesh);
  }

  // Props, as sprites against walls and pillars.
  const prop = (name, x, z) => {
    const p = PROPS[name], s = makeSprite(p.lines, p.colors, p.h);
    s.mesh.position.set(x, map.levelAt(x, z) ?? 0, z);
    scene.add(s.mesh);
    owned.push(s);
    return s;
  };
  prop('board', 8.5, 5.15);
  prop('bin', 10.6, 5.15);
  prop('vending', 6.5, 12.8);
  for (const c of [23, 35]) prop('bin', c + 0.5, 10.1);

  // The passing train (spec §5): 4 cars with ASCII panels and lit windows, headlights that bloom, and a light
  // that sweeps the platform edge ahead of it.
  const carTex = own(trainTexture(false)), carGlow = own(trainTexture(true));
  const carMat = own(new THREE.MeshStandardMaterial({ map: carTex, emissiveMap: carGlow, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.6, metalness: 0.3 }));
  // The panels go on the long sides only; the camera looks down on the roofs, and the ends meet the next car.
  const roofTex = own(glyphTexture(['#5a606c', '#a9afc2', '▤'], 0.3));
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  roofTex.repeat.set(TRAIN.car / 1.5, 2);
  const roofMat = own(new THREE.MeshStandardMaterial({ map: roofTex, emissive: '#1c2028', roughness: 0.7, metalness: 0.4 })); // a faint shape in the dark
  const carGeo = own(new THREE.BoxGeometry(TRAIN.car, 2.6, 2.3));
  const carMats = [roofMat, roofMat, roofMat, roofMat, carMat, carMat]; // +x, -x, +y, -y, +z, -z
  const train = new THREE.Group();
  const cars = [];
  for (let i = 0; i < TRAIN.cars; i++) { const m = new THREE.Mesh(carGeo, carMats); cars.push(m); train.add(m); }
  const lampGeo = own(new THREE.SphereGeometry(0.12, 12, 8));
  const lampMat = own(new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false }));
  const lamps = [new THREE.Mesh(lampGeo, lampMat), new THREE.Mesh(lampGeo, lampMat)];
  train.add(...lamps);
  train.visible = false;
  // The headlight and the tunnel glow are single lights that stay in the scene at intensity 0 between trains:
  // adding or hiding a light changes the light count, which recompiles every material (a hitch).
  const headlight = new THREE.PointLight('#fff1cc', 0, 14, 1.4);
  // Only one train runs at a time, so one light serves every tunnel mouth: it moves to the one a train is coming
  // out of, and glows for the 3 s of warning.
  const mouthLight = new THREE.PointLight('#ffd9a0', 0, 12, 1.5);
  scene.add(train, headlight, mouthLight);
  // Each mouth is closed by a dark plane, so a train out past the map's ends (in the void) is hidden and comes out
  // of the dark. It warms a little with the glow.
  const mouthGeo = own(new THREE.PlaneGeometry(1, 1));
  const mouths = map.tracks.flatMap((t) => [-1, 1].map((side) => {
    const mat = own(new THREE.MeshBasicMaterial({ color: '#05060a' }));
    const plane = new THREE.Mesh(mouthGeo, mat);
    plane.scale.set(t.z1 - t.z0, TUNNEL + 0.4, 1);
    plane.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    plane.position.set(side < 0 ? 0 : map.cols, t.y - 0.2 + (TUNNEL + 0.4) / 2, t.z);
    scene.add(plane);
    return { track: t, side, mat, x: side < 0 ? 0.3 : map.cols - 0.3 };
  }));
  const MOUTH_DARK = new THREE.Color('#05060a'), MOUTH_LIT = new THREE.Color('#2e2212');

  // Dust in the light, blown along when a train passes.
  const DUST = reducedMotion ? 80 : 160;
  const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = rnd() * 14 - 7; dustPos[i * 3 + 1] = rnd() * 3.2; dustPos[i * 3 + 2] = rnd() * 10 - 5; dustVel[i] = 0.05 + rnd() * 0.1; }
  const dustGeo = own(new THREE.BufferGeometry());
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dustMat = own(new THREE.PointsMaterial({ color: '#cdd6ea', size: 0.05, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false; // it follows you, and its bounding sphere is computed once
  scene.add(dust);

  // Drips into each puddle, with a ripple.
  const dripGeo = own(new THREE.SphereGeometry(0.03, 6, 4));
  const ringGeo = own(new THREE.RingGeometry(0.05, 0.08, 24).rotateX(-Math.PI / 2));
  const waterMat = own(new THREE.MeshBasicMaterial({ color: '#9fc7ff', transparent: true, opacity: 0.8, depthWrite: false }));
  const puddles = map.cells.filter((c) => c.ch === '~').map((c, i) => {
    const drop = new THREE.Mesh(dripGeo, waterMat), ring = new THREE.Mesh(ringGeo, own(waterMat.clone()));
    scene.add(drop, ring);
    return { x: c.c + 0.5, z: c.r + 0.5, y: c.level, drop, ring, period: 1.3 + i * 0.37 };
  });

  // A sheet of newspaper on the platform, which the train's wind skitters along.
  const news = makeSprite(PROPS.news.lines, PROPS.news.colors, PROPS.news.h);
  owned.push(news);
  news.mesh.position.set(30.5, LEVEL.platform, 12.4);
  scene.add(news.mesh);
  const flicker = tubes.length > 3 ? 3 : 0; // the one tube with a fault

  return {
    tubes, owned,
    update(time, dt, walker, pass) {
      placeWalls(walker);
      const passing = !!pass && pass.phase === 'pass';
      // Tubes: steady, but one has a fault, and the ones near a passing train shudder (spec §5; neither with
      // reduced motion).
      for (let i = 0; i < tubes.length; i++) {
        const t = tubes[i];
        let k = 1;
        if (i === flicker && !reducedMotion) k = Math.sin(time * 31) + Math.sin(time * 7.3) > 1.3 ? 0.15 : 1;
        if (passing && !reducedMotion && Math.abs(t.x - pass.head) < 4) k *= 0.55 + 0.45 * Math.abs(Math.sin(time * 53 + i));
        t.light.intensity = t.base * k;
        t.bar.visible = k > 0.3;
        t.bar.material = nearCamera(t.x, t.z, walker, 1.6) ? tubeFadeMat : tubeMat;
      }
      // The tunnel the train comes out of glows for the warning, and stays lit while it passes.
      let glow = 0;
      for (let i = 0; i < mouths.length; i++) {
        const m = mouths[i];
        const coming = !!pass && pass.track === m.track && (pass.dir > 0 ? m.side < 0 : m.side > 0);
        const g = coming ? (pass.phase === 'warn' ? pass.warn : 1) : 0;
        m.mat.color.lerpColors(MOUTH_DARK, MOUTH_LIT, g);
        if (coming) { glow = g; mouthLight.position.set(m.x, m.track.y + 1.6, m.track.z); }
      }
      mouthLight.intensity = 25 * glow;
      train.visible = passing;
      headlight.intensity = 0;
      if (passing) {
        const t = pass.track, y = t.y + 1.45;
        for (let i = 0; i < cars.length; i++) cars[i].position.set(pass.head - pass.dir * (TRAIN.car / 2 + i * (TRAIN.car + TRAIN.gap)), y, t.z);
        lamps[0].position.set(pass.head + pass.dir * 0.02, y - 0.6, t.z - 0.7);
        lamps[1].position.set(pass.head + pass.dir * 0.02, y - 0.6, t.z + 0.7);
        headlight.position.set(pass.head + pass.dir * 3, y - 0.4, t.z);
        // Off while the nose is still inside the tunnel, so it doesn't light the walls from the void.
        headlight.intensity = pass.head > 0 && pass.head < map.cols ? 18 : 0;
      }
      // Dust follows the view, drifting; a passing train blows it along, and it stirs before.
      const wind = passing ? pass.dir * 6 * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 25) : pass && pass.phase === 'warn' ? 0.6 * pass.dir : 0;
      const slow = reducedMotion ? 0.4 : 1;
      for (let i = 0; i < DUST; i++) {
        dustPos[i * 3] += (wind + Math.sin(time * 0.3 + i) * 0.05) * dt * slow;
        dustPos[i * 3 + 1] += dustVel[i] * Math.sin(time * 0.5 + i * 1.7) * dt * slow;
        if (dustPos[i * 3] > 7) dustPos[i * 3] -= 14; else if (dustPos[i * 3] < -7) dustPos[i * 3] += 14;
      }
      dust.position.set(walker.x, walker.y, walker.z - 1);
      dustGeo.attributes.position.needsUpdate = true;
      // Drips: 0.6 s falling from the ceiling, then a ripple for 0.8 s.
      for (let i = 0; i < puddles.length; i++) {
        const p = puddles[i];
        const ph = (time % p.period) / p.period, fallEnd = 0.6 / p.period;
        p.drop.visible = ph < fallEnd;
        p.drop.position.set(p.x, p.y + 3.4 * (1 - ph / fallEnd), p.z);
        const rt = (ph - fallEnd) * p.period;
        p.ring.visible = rt > 0 && rt < 0.8;
        p.ring.position.set(p.x, p.y + 0.02, p.z);
        p.ring.scale.setScalar(1 + rt * 7);
        p.ring.material.opacity = 0.8 * (1 - rt / 0.8);
      }
      // The newspaper skitters in the wind where it lies (a train on the far track barely stirs it), and stops
      // at the platform's ends.
      const nm = news.mesh;
      const near = passing ? (Math.abs(pass.track.z - nm.position.z) < 6 ? 1 : 0.3) * Math.max(0, 1 - Math.abs(pass.head - nm.position.x) / 12) : 0;
      if (near > 0) {
        nm.position.x = Math.min(45, Math.max(21, nm.position.x + pass.dir * 3 * near * dt));
        nm.rotation.z = Math.sin(time * 9) * 0.3 * near;
      } else nm.rotation.z *= Math.exp(-dt * 6);
    },
    // A very slight shake while a train passes near you (spec §5; none with reduced motion).
    shake(time, walker, pass) {
      if (reducedMotion || !pass || pass.phase !== 'pass') { SHAKE.x = SHAKE.y = 0; return SHAKE; }
      const a = 0.05 * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 20);
      SHAKE.x = a * Math.sin(time * 61); SHAKE.y = a * Math.sin(time * 47);
      return SHAKE;
    },
    dispose() {
      scene.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      for (const o of owned) o.dispose();
    },
  };
}

function nameTexture(name) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#1b2a4a'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#d8e2f5'; g.lineWidth = 6; g.strokeRect(8, 8, 496, 112);
  g.fillStyle = '#eef3ff'; g.font = `700 64px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function trainTexture(glow) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = glow ? '#000' : '#7d8592'; g.fillRect(0, 0, 512, 256);
  if (!glow) { g.fillStyle = '#b8323a'; g.fillRect(0, 176, 512, 18); }
  for (let i = 0; i < 6; i++) { // windows
    g.fillStyle = glow ? '#d9b070' : '#2a2620';
    g.fillRect(24 + i * 82, 56, 64, 72);
    if (!glow) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = `40px ${FONT}`; g.fillText('▤', 40 + i * 82, 110); }
  }
  if (!glow) { g.fillStyle = '#e8ecf2'; g.font = `700 22px ${FONT}`; g.fillText('MUSEUM LINE', 190, 230); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
