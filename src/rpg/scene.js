// The station in 3D (station spec §5): lit shapes with faint ASCII painted on them, built from the map.
// Walls, floors, stairs, pillars, benches and the kiosk are instanced unit boxes, one per tile (walls stacked a box
// per unit of height), so the texture repeats once per world unit. The turnstiles are turnstiles.js's.
import * as THREE from 'three';
import { LEVEL } from './map.js';
import { makeSprite, PROPS, FONT, boxed } from './sprites.js';
import { TRAIN, departures } from './train.js';
import { STATION_LIFE, createPigeon, stepPigeon, createRat, stepRat } from './life.js';
import { buildTurnstiles } from './turnstiles.js';

export const WALL_HEIGHT = 4; // over the highest floor beside a wall
// Walls this close on the camera's side fade (spec §4). The eye sits cos 35° × 10 ≈ 8.2 south of the focus, plus
// up to ~1 of spring lag, and is lower than the outer walls' tops; a reach shorter than that left the south wall
// solid between the eye and you (a black screen walking north past z ≈ 11.5 on the platform).
const FADE_REACH = 10;
const TUNNEL = 3.4; // a tunnel mouth's height over the track
const FADE_OPACITY = 0.2; // a faded wall's or pillar's nearest face

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
  const fadeBox = (kind, c, r, y, s = 1, h = 1) => fading[kind].push({ c, r, m: new THREE.Matrix4().compose(new THREE.Vector3(c + 0.5, y + h / 2, r + 0.5), new THREE.Quaternion(), new THREE.Vector3(s, h, s)) });
  // A wall column from lo up to top, stacked down from its top so every wall's top (and its ┼ grid) lines up.
  // The bottom cube reaches under lo, out of sight beside the floor, unless the column's foot shows (the wall
  // over a tunnel mouth), when it's cut to end at lo.
  const wallColumn = (c, r, lo, top, exact = false) => {
    for (let y = top - 1; y > lo - 1 + 1e-6; y -= 1) {
      if (exact && y < lo) fadeBox('wall', c, r, lo, 1, y + 1 - lo); else fadeBox('wall', c, r, y);
    }
  };
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
      wallColumn(c, r, lo, top);
      continue;
    }
    if (ch === '=') {
      box('track', x, LEVEL.track - 0.1, z, 1, 0.2, 1);
      // Where a track leaves the map (a tunnel), the end wall carries on over it, so the mouth is a dark opening.
      if (c === 0 || c === map.cols - 1) wallColumn(c, r, LEVEL.track + TUNNEL, roof, true);
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
  // Lights and signs between the camera and you don't vanish: like the walls and pillars they fade to a faint,
  // see-through pane (spec §4). Each registered thing eases toward FADE_OPACITY; faded, it writes no depth and draws
  // after you (render order 9, with the faded walls), so it only tints you and never punches a hole. Its colour
  // dims with it, so the bloom can't blow a faded tube or lit sign back up to full white.
  const faders = [];
  const DIM = 0.35; // a faded light's colour, as a share of its own
  const fadeable = (meshes, x, z, side, { opacity = FADE_OPACITY, dim = DIM } = {}) => {
    const list = (Array.isArray(meshes) ? meshes : [meshes]).map((m) => ({ m, order: m.renderOrder, depth: m.material.depthWrite, base: m.material.color.clone() }));
    for (const { m } of list) m.material.transparent = true;
    const f = { list, x, z, side, opacity, dim, k: 0, set: null };
    faders.push(f);
    return f;
  };
  const stepFaders = (walker, dt) => {
    const ease = 1 - Math.exp(-dt / 0.12);
    for (let i = 0; i < faders.length; i++) {
      const f = faders[i];
      const want = nearCamera(f.x, f.z, walker, f.side) ? 1 : 0;
      f.k += (want - f.k) * ease;
      if (Math.abs(want - f.k) < 0.01) f.k = want;
      for (let j = 0; j < f.list.length; j++) {
        const { m, order, depth, base } = f.list[j], mat = m.material;
        mat.opacity = 1 + (f.opacity - 1) * f.k;
        mat.color.copy(base).multiplyScalar(1 + (f.dim - 1) * f.k);
        const faded = f.k > 0.01;
        mat.depthWrite = faded ? false : depth;
        m.renderOrder = faded ? 9 : order;
      }
    }
  };
  // Faded walls draw only their nearest face: a depth-only pass first, then the colour where it's nearest, so you
  // see one clean pane of wall, not every stacked cube's inside faces. Both draw after everything else (you
  // included), so a faded wall only ever tints you, never hides you.
  const depthOnly = own(new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true }));
  const fadeSets = Object.entries(fading).filter(([, list]) => list.length).map(([kind, list]) => {
    const fadeMat = own(mats[kind].clone());
    fadeMat.transparent = true; fadeMat.opacity = FADE_OPACITY; fadeMat.depthWrite = false; fadeMat.depthFunc = THREE.LessEqualDepth;
    const solid = new THREE.InstancedMesh(unit, mats[kind], list.length), faded = new THREE.InstancedMesh(unit, fadeMat, list.length);
    const mask = new THREE.InstancedMesh(unit, depthOnly, list.length);
    mask.instanceMatrix = faded.instanceMatrix; // the same instances
    mask.renderOrder = 8; faded.renderOrder = 9;
    // placeWalls moves instances between these two every few steps, and three.js computes an InstancedMesh's
    // bounding sphere once, from the instances it had then; culling against that stale sphere would drop them.
    solid.frustumCulled = faded.frustumCulled = mask.frustumCulled = false;
    scene.add(solid, mask, faded);
    return { side: kind === 'wall' ? FADE_REACH : 1.6, list, solid, faded, mask };
  });
  let fadedFor = '';
  const placeWalls = (w) => {
    const key = `${Math.floor(w.x)},${Math.floor(w.z)}`;
    if (key === fadedFor) return;
    fadedFor = key;
    for (const { side, list, solid, faded, mask } of fadeSets) {
      let a = 0, b = 0;
      for (const wl of list) {
        if (nearCamera(wl.c + 0.5, wl.r + 0.5, w, side)) faded.setMatrixAt(b++, wl.m); else solid.setMatrixAt(a++, wl.m);
      }
      solid.count = a; faded.count = mask.count = b;
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
  const tubes = map.tubes.map((t) => {
    const bar = new THREE.Mesh(tubeGeo, own(tubeMat.clone()));
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
    fadeable(up.mesh, mid.x + 0.6, mid.z, 1.4);
    scene.add(warm, up.mesh);
  }

  // Props, as sprites against walls and pillars. Each is tall only where there's no floor behind it (north of it,
  // away from the camera): a prop writes depth, so it would hide you there. So the tall ones stand on the north
  // walls, the bins in front of pillars, and the signs hang flat on wall faces.
  const prop = (name, x, z, lift = 0, opts = {}) => {
    const p = PROPS[name], s = makeSprite(p.lines, p.colors, p.h, { ...p.opts, ...opts });
    s.mesh.position.set(x, (map.levelAt(x, z) ?? LEVEL.track) + lift, z);
    scene.add(s.mesh);
    owned.push(s);
    fadeable(s.mesh, x, z, s.mesh.geometry.parameters.width / 2 + 0.6);
    return s;
  };
  // The hall's north wall: the kiosk (closed, its sign on the shutter), a bin, the line map, the drinks machine by
  // the turnstiles.
  prop('bin', 11.35, 13.72); // by the turnstiles, against the south wall
  prop('closed', 4.5, 7.03, 1.25);
  prop('map', 8.1, 5.06, 1.15);
  prop('vending', 11.05, 5.15);
  for (const c of [23, 35]) prop('bin', c + 0.5, 10.1);
  // Over the turnstiles and the stair head, on the stair wall's south face: the clock and the departures board.
  const wallFace = 6.02;
  const clockText = (d, tick) => boxed([` ${String(d.getHours()).padStart(2, '0')}${tick ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')} `], 7);
  let clockKey = '';
  const clock = makeSprite(clockText(new Date(), true), ['#5a2a24', '#ff6a4a', '#5a2a24'], 0.56, { glow: true, bright: 1.35, bg: '#0b0605' });
  clock.mesh.position.set(12.5, 2.5, wallFace); // over the turnstile line
  const boardLines = (d) => [' DEPARTURES', ...d.lines.map((l) => ` ${l} `)];
  const board = makeSprite(boardLines(departures(0, map)), ['#ffd27a', '#ffb340', '#ffb340'], 0.85, { glow: true, bright: 1.6, bg: '#050402', gap: 0.25, frame: '#6a4a18' });
  board.mesh.position.set(15.7, 2.0, wallFace);
  let boardKey = '', boardAt = -1;
  owned.push(clock, board);
  fadeable(clock.mesh, 12.5, wallFace, clock.mesh.geometry.parameters.width / 2 + 0.6);
  fadeable(board.mesh, 15.7, wallFace, board.mesh.geometry.parameters.width / 2 + 0.6);
  scene.add(clock.mesh, board.mesh);
  // Across the north track, facing the platform: an exhibition poster, a warning, and one torn poster whose corner
  // flaps in a train's wind.
  const far = 1.03;
  prop('nowShowing', 24.6, far, 1.15);
  prop('torn', 28.4, far, 1.45);
  prop('gap', 38.5, far, 1.75);
  const flap = makeSprite(PROPS.flap.lines, PROPS.flap.colors, PROPS.flap.h, { depth: false });
  flap.mesh.geometry.translate(-0.13, 0, 0); // hinged on its left edge, at the tear
  flap.mesh.position.set(28.85, LEVEL.track + 1.45 + 0.62, far + 0.01);
  owned.push(flap);
  scene.add(flap.mesh);

  // The LED ticker hung between two pillars: one long line of text drawn once, scrolled a whole character at a time.
  const TICKER = '   THE NEXT TRAIN DOES NOT STOP AT THIS STATION  ·  PLEASE STAND BEHIND THE YELLOW LINE  ·  MIND THE GAP  ·  faiz.pics: NOW SHOWING UPSTAIRS  ·  KEEP YOUR BELONGINGS WITH YOU  ·';
  const TICK_SHOW = 30, tickerTex = own(tickerTexture(TICKER));
  tickerTex.wrapS = THREE.RepeatWrapping;
  tickerTex.repeat.set(TICK_SHOW / TICKER.length, 1);
  const tickerMat = own(new THREE.MeshBasicMaterial({ map: tickerTex, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false }));
  const tickerBoxMat = own(new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.6, metalness: 0.4 }));
  const ticker = { x: 26.5, z: 9.5, y: LEVEL.platform + 2.55, w: 4.6 };
  const tickerBox = new THREE.Mesh(unit, tickerBoxMat);
  tickerBox.scale.set(ticker.w + 0.12, 0.36, 0.14);
  tickerBox.position.set(ticker.x, ticker.y, ticker.z);
  const tickerFace = new THREE.Mesh(own(new THREE.PlaneGeometry(ticker.w, 0.24)), tickerMat);
  tickerFace.position.set(ticker.x, ticker.y, ticker.z + 0.075);
  scene.add(tickerBox, tickerFace);
  fadeable([tickerBox, tickerFace], ticker.x, ticker.z, ticker.w / 2 + 0.6);

  // The turnstiles: steel cabinets, rotors and tap targets, and the emergency gate (turnstiles.js).
  const turnstiles = buildTurnstiles(scene, map, own, { reducedMotion });
  for (const g of turnstiles.signs) fadeable(g.mesh, g.x, g.z, g.side);

  // The buzzing lamp over the kiosk: a short tube on the shutter's lintel that never quite settles.
  const kioskBar = new THREE.Mesh(own(new THREE.BoxGeometry(1.1, 0.05, 0.1)), own(new THREE.MeshBasicMaterial({ color: '#fff1d6', toneMapped: false })));
  kioskBar.position.set(4.5, 2.0, 7.1);
  const kioskLight = new THREE.PointLight('#ffe2b0', 3, 4, 1.6);
  kioskLight.position.set(4.5, 1.9, 7.5);
  scene.add(kioskBar, kioskLight);

  // A steam vent in the hall floor: a grate, and soft puffs rising out of it.
  const vent = { x: 6.5, z: 12.2 };
  const grate = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 0.7).rotateX(-Math.PI / 2)), own(new THREE.MeshStandardMaterial({ map: own(grateTexture()), roughness: 0.6, metalness: 0.5 })));
  grate.position.set(vent.x, LEVEL.hall + 0.012, vent.z);
  scene.add(grate);
  const puffTex = own(puffTexture()), puffGeo = own(new THREE.PlaneGeometry(1, 1));
  const PUFFS = reducedMotion ? 4 : 8, PUFF_LIFE = reducedMotion ? 5 : 3.2;
  const puffs = Array.from({ length: PUFFS }, (_, i) => {
    const m = new THREE.Mesh(puffGeo, own(new THREE.MeshBasicMaterial({ map: puffTex, color: '#c9d2df', transparent: true, depthWrite: false, opacity: 0 })));
    m.renderOrder = 3;
    scene.add(m);
    return { m, phase: i / PUFFS, dx: Math.sin(i * 2.3) * 0.18 };
  });

  // The passing train (spec §5): 4 cars with ASCII panels and lit windows, headlights that bloom, and a light
  // that sweeps the platform edge ahead of it.
  const carTex = own(trainTexture(false)), carGlow = own(trainTexture(true));
  const carMat = own(new THREE.MeshStandardMaterial({ map: carTex, emissiveMap: carGlow, emissive: '#ffffff', emissiveIntensity: 1, roughness: 0.6, metalness: 0.3 }));
  // The panels go on the long sides only; the camera looks down on the roofs, and the ends meet the next car.
  // A train on the south track shows you mostly its roof, so the roof is a lighter grey with its ▤ panels
  // plain, and faintly lit, to read as a train from above.
  const roofTex = own(glyphTexture(['#7d8592', '#dfe4ee', '▤'], 0.5));
  roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
  roofTex.repeat.set(TRAIN.car / 1.5, 2);
  const roofMat = own(new THREE.MeshStandardMaterial({ map: roofTex, emissive: '#2c323e', roughness: 0.7, metalness: 0.3 })); // a faint shape in the dark
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
  const headlight = new THREE.PointLight('#fff1cc', 0, 10, 1.4);
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

  // Dust in the light, blown along when a train passes. The motes hang in world space and you walk through them;
  // one that falls outside a box around you wraps to the box's far side (x ±7, z −6…+4 with more room to the
  // north, where the camera looks, y from your floor to 3.2 over it), out at the dim, blurred edges of the view.
  const DUST_X = 7, DUST_N = 6, DUST_S = 4, DUST_H = 3.2;
  const wrapInto = (v, lo, size) => lo + ((((v - lo) % size) + size) % size);
  // A light haze of specks in the light, not a field of dots. Additive, so a mote's colour is its brightness: it
  // fades over DUST_LIT from the nearest tube or your lantern, to a dim DUST_FLOOR away from both.
  const DUST = reducedMotion ? 45 : 90, DUST_LIT = 5, DUST_FLOOR = 0.25, DUST_LANTERN = 2.5;
  const dustPos = new Float32Array(DUST * 3), dustVel = new Float32Array(DUST);
  let seed = 11;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < DUST; i++) { dustPos[i * 3] = rnd() * 14 - 7; dustPos[i * 3 + 1] = rnd() * 3.2; dustPos[i * 3 + 2] = rnd() * 10 - 5; dustVel[i] = 0.05 + rnd() * 0.1; }
  const dustGeo = own(new THREE.BufferGeometry());
  const dustCol = new Float32Array(DUST * 3);
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  dustGeo.setAttribute('color', new THREE.BufferAttribute(dustCol, 3));
  const dustMat = own(new THREE.PointsMaterial({ color: '#cdd6ea', vertexColors: true, size: 0.055, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false }));
  const dust = new THREE.Points(dustGeo, dustMat);
  dust.frustumCulled = false; // its motes wrap around you, and its bounding sphere is computed once
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
  // Pigeons on the platform and rats on the track bed (life.js steps them; these draw them). One sprite per frame of
  // art, shared, and a mesh per creature per frame with its own material, so each fades on its own.
  const frameSet = (art) => Object.fromEntries(Object.entries(art.frames).map(([k, lines]) => {
    const s = makeSprite(lines, art.colors, art.h, art.opts);
    owned.push(s);
    return [k, s];
  }));
  const creatureMeshes = (frames) => Object.fromEntries(Object.entries(frames).map(([k, s]) => {
    const m = new THREE.Mesh(s.mesh.geometry, own(s.mesh.material.clone()));
    m.renderOrder = 2;
    m.visible = false;
    scene.add(m);
    return [k, m];
  }));
  const pigeonFrames = frameSet(PROPS.pigeon), ratFrames = frameSet(PROPS.rat);
  const pigeons = STATION_LIFE.pigeons.map((p, i) => ({ s: createPigeon(p, i), m: creatureMeshes(pigeonFrames) }));
  const rats = STATION_LIFE.rats.map((r, i) => ({ s: createRat(r, map, i), m: creatureMeshes(ratFrames) }));
  const showFrame = (meshes, key, x, y, z, face, alpha = 1) => {
    for (const k in meshes) {
      const m = meshes[k];
      m.visible = k === key && alpha > 0.02;
      if (!m.visible) continue;
      m.position.set(x, y, z);
      m.scale.x = face;
      m.material.opacity = alpha;
    }
  };

  // The one tube with a fault: dimmer and a little green all the time (so it reads with reduced motion too), and
  // every few seconds it stutters, a burst of on-off at about 4 a second.
  const flicker = tubes.length > 3 ? 3 : 0;
  if (tubes.length) {
    const t = tubes[flicker];
    t.base = 4;
    t.bar.material.color.set('#b9d6c8');
  }

  // Tubes south of you (at any x: the camera is kept inside the map, so it isn't always straight behind you) would
  // float mid-screen as solid slabs, so they fade.
  // A tube is a bright bar seen from above, so at the walls' 20% it still reads as a grey slab on the floor: it goes
  // fainter, a ghost of itself.
  for (const t of tubes) fadeable(t.bar, t.x, t.z, Infinity, { opacity: 0.1, dim: 0.2 });

  // Everything added in round 2 (station spec, "Life and props"): signs, the ticker, the turnstiles, the vent, the creatures.
  const updateLife = (time, dt, walker, pass, gates) => {
    // The clock: real local time, its colon ticking each second (steady with reduced motion).
    const now = Date.now(), tick = reducedMotion || Math.floor(now / 500) % 2 === 0;
    const key = `${Math.floor(now / 60000)}${tick}`;
    if (key !== clockKey) { clockKey = key; clock.draw(clockText(new Date(now), tick)); }
    // The departures board, looked at four times a second and redrawn only when its text changes.
    if (time - boardAt > 0.25 || time < boardAt) {
      boardAt = time;
      const d = departures(time, map, !reducedMotion);
      const k = d.lines.join('|');
      if (k !== boardKey) { boardKey = k; board.draw(boardLines(d)); }
    }
    // The ticker: a character every 0.18 s (slower with reduced motion); dimmed when it hangs between the camera and you.
    const step = Math.floor(time / (reducedMotion ? 0.4 : 0.18));
    tickerTex.offset.x = (step % TICKER.length) / TICKER.length;
    // The turnstiles' rotors and tap targets, and the emergency gate.
    turnstiles.update(time, walker, gates);
    // The kiosk lamp buzzes: mostly on, with a quick dip now and then (steady with reduced motion).
    let kk = 1;
    if (!reducedMotion) {
      const b = Math.sin(time * 37) * Math.sin(time * 2.9 + 1) + Math.sin(time * 11.3) * 0.4;
      kk = b > 0.85 ? 0.15 : 0.9 + 0.1 * Math.sin(time * 120);
    }
    kioskLight.intensity = 3 * kk;
    kioskBar.visible = kk > 0.3;
    // Steam from the vent: puffs rise, swell and fade, some breaths stronger than others.
    for (let i = 0; i < puffs.length; i++) {
      const p = puffs[i], k = ((time / PUFF_LIFE + p.phase) % 1 + 1) % 1;
      const breath = 0.65 + 0.35 * Math.sin(time * 0.6 + i);
      p.m.position.set(vent.x + p.dx + Math.sin(time * 0.8 + i) * 0.12 * k, LEVEL.hall + 0.1 + 2.2 * k, vent.z - 0.3 * k);
      p.m.scale.setScalar(0.35 + 1.0 * k);
      p.m.material.opacity = 0.42 * breath * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
    }
    // The torn corner flaps in the wind of a train on the north track.
    const fl = flap.mesh;
    const gust = pass && pass.phase === 'pass' && pass.track === map.tracks[0] ? Math.max(0, 1 - Math.abs(pass.head - fl.position.x) / 14) : 0;
    const want = reducedMotion ? gust * 0.6 : gust * (0.7 + 0.5 * Math.sin(time * 23)) ;
    fl.rotation.y += ((want * 1.1) - fl.rotation.y) * (1 - Math.exp(-dt * 12));
    // Pigeons and rats.
    for (const { s, m } of pigeons) {
      stepPigeon(s, dt, { walker, train: pass, reducedMotion });
      const key = s.state === 'fly' || s.state === 'land' ? (s.flap ? 'up' : 'down') : s.peck ? 'peck' : 'stand';
      showFrame(m, key, s.x, LEVEL.platform + s.y, s.z, s.face, s.alpha);
    }
    for (const { s, m } of rats) {
      stepRat(s, dt, { train: pass }, map);
      const key = Math.floor(s.walked * 6) % 2 ? 'b' : 'a';
      showFrame(m, key, s.x, LEVEL.track, s.z, s.face, s.visible ? 1 : 0);
    }
  };

  return {
    tubes, owned, pigeons, rats,
    update(time, dt, walker, pass, gates = null) {
      placeWalls(walker);
      updateLife(time, dt, walker, pass, gates);
      stepFaders(walker, dt);
      const passing = !!pass && pass.phase === 'pass';
      // Tubes: steady, but one has a fault, and the ones near a passing train shudder (spec §5; neither with
      // reduced motion).
      for (let i = 0; i < tubes.length; i++) {
        const t = tubes[i];
        let k = 1;
        if (i === flicker && !reducedMotion) {
          const ph = (time + 1.3) % 4.1; // a 0.9 s stutter every 4.1 s, and a flick now and then between
          k = ph < 0.9 ? (Math.sin(time * 26) > -0.2 ? 0.1 : 1) : Math.sin(time * 31) + Math.sin(time * 7.3) > 1.75 ? 0.1 : 1;
        }
        if (passing && !reducedMotion && Math.abs(t.x - pass.head) < 4) k *= 0.55 + 0.45 * Math.abs(Math.sin(time * 53 + i));
        t.light.intensity = t.base * k;
        // A tube between the camera and you (south of you, at any x: the camera is kept inside the map, so it isn't
        // always straight behind you) would float mid-screen, so its bar goes (its light stays).
        t.bar.visible = k > 0.3; // in front of you it fades (stepFaders) rather than going
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
        // Ahead of the nose and over the platform's edge, away from the outer wall, which it would wash out.
        headlight.position.set(pass.head + pass.dir * 3, y - 0.4, t.z + (t.z < map.rows / 2 ? 1.6 : -1.6));
        // Off while the nose is still inside the tunnel, so it doesn't light the walls from the void.
        headlight.intensity = pass.head > 0 && pass.head < map.cols ? 10 : 0;
      }
      // Dust drifts; a passing train blows it along, and it stirs before. Motes outside the box around you wrap
      // in (all at once on the frame you arrive somewhere new, which is as good as a cut).
      const wind = passing ? pass.dir * 6 * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 25) : pass && pass.phase === 'warn' ? 0.6 * pass.dir : 0;
      const slow = reducedMotion ? 0.4 : 1;
      for (let i = 0; i < DUST; i++) {
        const j = i * 3;
        dustPos[j] = wrapInto(dustPos[j] + (wind + Math.sin(time * 0.3 + i) * 0.05) * dt * slow, walker.x - DUST_X, 2 * DUST_X);
        dustPos[j + 1] = wrapInto(dustPos[j + 1] + dustVel[i] * Math.sin(time * 0.5 + i * 1.7) * dt * slow, walker.y, DUST_H);
        dustPos[j + 2] = wrapInto(dustPos[j + 2], walker.z - DUST_N, DUST_N + DUST_S);
        let near = Infinity;
        for (let k = 0; k < tubes.length; k++) {
          const t = tubes[k], dx = t.x - dustPos[j], dy = t.y - dustPos[j + 1], dz = t.z - dustPos[j + 2];
          near = Math.min(near, dx * dx + dy * dy + dz * dz);
        }
        const ldx = walker.x - dustPos[j], ldy = walker.y + 0.6 - dustPos[j + 1], ldz = walker.z - dustPos[j + 2];
        const tube = Math.max(0, 1 - Math.sqrt(near) / DUST_LIT);
        const lamp = Math.max(0, 1 - Math.sqrt(ldx * ldx + ldy * ldy + ldz * ldz) / DUST_LANTERN);
        const lit = Math.max(tube, lamp);
        dustCol[j] = dustCol[j + 1] = dustCol[j + 2] = DUST_FLOOR + (1 - DUST_FLOOR) * lit * lit;
      }
      dustGeo.attributes.color.needsUpdate = true;
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

// The ticker's LED text: amber dots on black, drawn once, as wide as the whole message.
function tickerTexture(text) {
  const px = 28, c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = `700 ${px}px ${FONT}`;
  const cw = g.measureText('M').width;
  c.width = Math.ceil(cw * text.length); c.height = 40;
  g.fillStyle = '#060402'; g.fillRect(0, 0, c.width, c.height);
  g.font = `700 ${px}px ${FONT}`; g.textBaseline = 'middle'; g.fillStyle = '#ffae3a';
  [...text].forEach((ch, i) => g.fillText(ch, i * cw, c.height / 2 + 1));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The vent's grate: dark slots in a steel frame.
function grateTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 90;
  const g = c.getContext('2d');
  g.fillStyle = '#6a6e78'; g.fillRect(0, 0, 128, 90);
  g.fillStyle = '#0c0d10';
  for (let i = 0; i < 7; i++) g.fillRect(10 + i * 16, 10, 9, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// A soft round puff of steam.
function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  r.addColorStop(0, 'rgba(255,255,255,0.9)'); r.addColorStop(0.5, 'rgba(255,255,255,0.35)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
