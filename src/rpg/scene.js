// The station in 3D (station spec §5): lit shapes with faint ASCII painted on them, built from the map.
// Walls, floors, stairs, pillars, benches and the kiosk are instanced unit boxes, one per tile (walls stacked a box
// per unit of height), so the texture repeats once per world unit. The turnstiles are turnstiles.js's.
import * as THREE from 'three';
import { LEVEL, ceilings } from './map.js';
import { makeSprite, PROPS, FONT, boxed } from './sprites.js';
import { departures } from './schedule.js';
import { DECOR } from './decor.js';
import { tubeFault, DRIP } from './sound.js';
import { createPigeon, stepPigeon, createRat, stepRat } from './life.js';
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
  tape: ['#2a2410', '#f2c230', '╱'],
};

const CEILING = ['#2c3039', '#6a7184', '┼']; // a little darker than the walls; the lamps hang 0.6 under it

// scene: a THREE.Group the caller places at the station's x on the line; the scene's background, fog and sky light are
// the caller's too (index.js), since the line has more than one station.
export function buildScene(scene, map, { reducedMotion = false, decor = DECOR[map.name] } = {}) {
  const SHAKE = { x: 0, y: 0 }; // reused each frame
  const owned = []; // everything to dispose
  const own = (x) => { owned.push(x); return x; };

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
  // The ceiling (seen in first person, firstperson.js): WALL_HEIGHT over the floor below (map.js's ceilings), a
  // down-facing tile per open tile, and a face where it steps between heights. Down-facing only, so the camera over
  // your shoulder, up above it, sees straight through.
  const ceilAt = ceilings(map, WALL_HEIGHT), pos = [], uv = [];
  const quad = (a, b, c, d, w, h) => { // corners in order round the face, seen from its front
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    uv.push(0, 0, w, 0, w, h, 0, 0, w, h, 0, h);
  };
  for (let r = 0; r < map.rows; r++) for (let c = 0; c < map.cols; c++) {
    const y = ceilAt(c, r);
    if (y == null) continue;
    quad([c, y, r], [c + 1, y, r], [c + 1, y, r + 1], [c, y, r + 1], 1, 1);
    // A step up to the east or south neighbour's ceiling (or down from it): a face from the lower to the higher, toward the lower.
    for (const [dc, dr] of [[1, 0], [0, 1]]) {
      const y2 = ceilAt(c + dc, r + dr);
      if (y2 == null || y2 === y) continue;
      const lo = Math.min(y, y2), hi = Math.max(y, y2), x = c + dc, z = r + dr;
      const pts = dc ? [[x, lo, r], [x, lo, r + 1], [x, hi, r + 1], [x, hi, r]] : [[c, lo, z], [c + 1, lo, z], [c + 1, hi, z], [c, hi, z]];
      // Wound to face the lower side: this tile's if it's the lower, the neighbour's otherwise.
      const towardNext = y2 < y;
      const [a, b, cc, d] = (dc ? !towardNext : towardNext) ? pts : [pts[1], pts[0], pts[3], pts[2]];
      quad(a, b, cc, d, 1, hi - lo);
    }
  }
  const ceilGeo = own(new THREE.BufferGeometry());
  ceilGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  ceilGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  ceilGeo.computeVertexNormals();
  const ceilTex = own(glyphTexture(CEILING, 0.3));
  ceilTex.wrapS = ceilTex.wrapT = THREE.RepeatWrapping;
  const ceiling = new THREE.Mesh(ceilGeo, own(new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.95, metalness: 0, emissive: '#0c0e13' })));
  ceiling.name = 'ceiling';
  scene.add(ceiling);
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
    if (ch === 'x') { // tape across a closed exit, at the floor beside it
      const y = map.levelAt(x - 1, z) ?? 0;
      box('hall', x, y - 0.1, z, 1, 0.2, 1);
      box('tape', x, y + 0.55, z, 0.12, 1.1, 1);
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
  // Their light comes from a pool of TUBE_LIGHTS point lights, moved each frame to the tubes nearest you: every point
  // light costs every lit pixel, and the lengthened platform has twice the tubes.
  const TUBE_LIGHTS = 12;
  const tubes = map.tubes.map((t) => {
    const bar = new THREE.Mesh(tubeGeo, own(tubeMat.clone()));
    bar.position.set(t.x, t.y, t.z);
    scene.add(bar);
    return { ...t, bar, base: 7, k: 1 };
  });
  const tubeLights = Array.from({ length: Math.min(TUBE_LIGHTS, tubes.length) }, () => {
    const light = new THREE.PointLight('#cfe3ff', 0, 8, 1.6);
    scene.add(light);
    return light;
  });

  // The way back up: warm light over the exit, and a sign.
  if (map.exits.length && decor.exitSign) {
    const mid = map.exits[Math.floor(map.exits.length / 2)];
    const y = map.levelAt(mid.x, mid.z) ?? 0;
    const warm = new THREE.PointLight('#ffb35c', 10, 6, 1.8);
    warm.position.set(mid.x, y + 2.4, mid.z);
    const up = makeSprite([decor.exitSign], '#ffce6e', 0.5, { glow: true });
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
  for (const [name, x, z, lift = 0] of decor.props) prop(name, x, z, lift);
  // Over the turnstiles and the stair head, on the stair wall's south face: the clock and the departures board.
  const clockText = (d, tick) => boxed([` ${String(d.getHours()).padStart(2, '0')}${tick ? ':' : ' '}${String(d.getMinutes()).padStart(2, '0')} `], 7);
  let clockKey = '';
  const clock = decor.clock && makeSprite(clockText(new Date(), true), ['#5a2a24', '#ff6a4a', '#5a2a24'], 0.56, { glow: true, bright: 1.35, bg: '#0b0605' });
  if (clock) clock.mesh.position.set(decor.clock.x, decor.clock.y, decor.clock.z); // over the turnstile line
  const boardLines = (d) => [' DEPARTURES', ...d.lines.map((l) => ` ${l} `)];
  const board = makeSprite(boardLines(departures(0, decor.stop)), ['#ffd27a', '#ffb340', '#ffb340'], 0.85, { glow: true, bright: 1.6, bg: '#050402', gap: 0.25, frame: '#6a4a18' });
  board.mesh.position.set(decor.board.x, decor.board.y, decor.board.z);
  let boardKey = '', boardAt = -1;
  owned.push(board);
  if (clock) { owned.push(clock); fadeable(clock.mesh, decor.clock.x, decor.clock.z, clock.mesh.geometry.parameters.width / 2 + 0.6); scene.add(clock.mesh); }
  fadeable(board.mesh, decor.board.x, decor.board.z, board.mesh.geometry.parameters.width / 2 + 0.6);
  scene.add(board.mesh);
  // Across the north track, facing the platform: an exhibition poster, a warning, and one torn poster whose corner
  // flaps in a train's wind.
  let flap = null;
  if (decor.torn) {
    const { x, z, lift } = decor.torn;
    prop('torn', x, z, lift);
    flap = makeSprite(PROPS.flap.lines, PROPS.flap.colors, PROPS.flap.h, { depth: false });
    flap.mesh.geometry.translate(-0.13, 0, 0); // hinged on its left edge, at the tear
    flap.mesh.position.set(x + 0.45, LEVEL.track + lift + 0.62, z + 0.01);
    owned.push(flap);
    scene.add(flap.mesh);
  }
  if (decor.tape) prop('tape', decor.tape.x - 0.4, decor.tape.z, 0.15);

  // The LED ticker hung between two pillars: one long line of text drawn once, scrolled a whole character at a time.
  const TICKER = decor.ticker.text;
  const TICK_SHOW = 30, tickerTex = own(tickerTexture(TICKER));
  tickerTex.wrapS = THREE.RepeatWrapping;
  tickerTex.repeat.set(TICK_SHOW / TICKER.length, 1);
  const tickerMat = own(new THREE.MeshBasicMaterial({ map: tickerTex, color: new THREE.Color(1.7, 1.7, 1.7), toneMapped: false }));
  const tickerBoxMat = own(new THREE.MeshStandardMaterial({ color: '#15171c', roughness: 0.6, metalness: 0.4 }));
  const ticker = { x: decor.ticker.x, z: decor.ticker.z, y: LEVEL.platform + 2.55, w: decor.ticker.w };
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
  const kioskLight = new THREE.PointLight('#ffe2b0', 3, 4, 1.6);
  if (decor.kiosk) {
    kioskBar.position.set(decor.kiosk.x, 2.0, 7.1);
    kioskLight.position.set(decor.kiosk.x, 1.9, 7.5);
    scene.add(kioskBar, kioskLight);
  }

  // A steam vent in the hall floor: a grate, and soft puffs rising out of it.
  const vent = decor.vent;
  const grate = new THREE.Mesh(own(new THREE.PlaneGeometry(1, 0.7).rotateX(-Math.PI / 2)), own(new THREE.MeshStandardMaterial({ map: own(grateTexture()), roughness: 0.6, metalness: 0.5 })));
  if (vent) { grate.position.set(vent.x, LEVEL.hall + 0.012, vent.z); scene.add(grate); }
  const puffTex = own(puffTexture()), puffGeo = own(new THREE.PlaneGeometry(1, 1));
  const PUFFS = reducedMotion ? 4 : 8, PUFF_LIFE = reducedMotion ? 5 : 3.2;
  const puffs = Array.from({ length: PUFFS }, (_, i) => {
    const m = new THREE.Mesh(puffGeo, own(new THREE.MeshBasicMaterial({ map: puffTex, color: '#c9d2df', transparent: true, depthWrite: false, opacity: 0 })));
    m.renderOrder = 3;
    if (vent) scene.add(m);
    return { m, phase: i / PUFFS, dx: Math.sin(i * 2.3) * 0.18 };
  });

  // One light serves every tunnel mouth: it moves to the one a train is about to come out of, and glows for the 3 s of
  // warning. It stays in the scene at intensity 0 between trains: adding or hiding a light changes the light count,
  // which recompiles every material (a hitch).
  const mouthLight = new THREE.PointLight('#ffd9a0', 0, 12, 1.5);
  scene.add(mouthLight);
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
    return { x: c.c + 0.5, z: c.r + 0.5, y: c.level, drop, ring, period: DRIP.period(i) };
  });

  // A sheet of newspaper on the platform, which the train's wind skitters along.
  const news = decor.news && makeSprite(PROPS.news.lines, PROPS.news.colors, PROPS.news.h);
  if (news) {
    owned.push(news);
    news.mesh.position.set(decor.news.x, LEVEL.platform, decor.news.z);
    scene.add(news.mesh);
  }
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
  const pigeons = decor.life.pigeons.map((p, i) => ({ s: createPigeon(p, i), m: creatureMeshes(pigeonFrames) }));
  const rats = decor.life.rats.map((r, i) => ({ s: createRat(r, map, i), m: creatureMeshes(ratFrames) }));
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
  const updateLife = (time, dt, walker, pass, gates, trainT) => {
    // The clock: real local time, its colon ticking each second (steady with reduced motion).
    const now = Date.now(), tick = reducedMotion || Math.floor(now / 500) % 2 === 0;
    const key = `${Math.floor(now / 60000)}${tick}`;
    if (clock && key !== clockKey) { clockKey = key; clock.draw(clockText(new Date(now), tick)); }
    // The departures board, looked at four times a second and redrawn only when its text changes.
    if (trainT - boardAt > 0.25 || trainT < boardAt) {
      boardAt = trainT;
      const d = departures(trainT, decor.stop, !reducedMotion);
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
    kioskLight.intensity = decor.kiosk ? 3 * kk : 0;
    kioskBar.visible = !!decor.kiosk && kk > 0.3;
    // Steam from the vent: puffs rise, swell and fade, some breaths stronger than others.
    for (let i = 0; vent && i < puffs.length; i++) {
      const p = puffs[i], k = ((time / PUFF_LIFE + p.phase) % 1 + 1) % 1;
      const breath = 0.65 + 0.35 * Math.sin(time * 0.6 + i);
      p.m.position.set(vent.x + p.dx + Math.sin(time * 0.8 + i) * 0.12 * k, LEVEL.hall + 0.1 + 2.2 * k, vent.z - 0.3 * k);
      p.m.scale.setScalar(0.35 + 1.0 * k);
      p.m.material.opacity = 0.42 * breath * Math.sin(Math.PI * Math.min(1, k * 1.4)) * (1 - k);
    }
    // The torn corner flaps in the wind of a train on the north track.
    if (flap) {
      const fl = flap.mesh;
      const gust = pass && pass.phase === 'pass' && pass.track === map.tracks[0] ? Math.max(0, 1 - Math.abs(pass.head - fl.position.x) / 14) * Math.min(1, pass.speed / 20) : 0;
      const want = reducedMotion ? gust * 0.6 : gust * (0.7 + 0.5 * Math.sin(time * 23)) ;
      fl.rotation.y += ((want * 1.1) - fl.rotation.y) * (1 - Math.exp(-dt * 12));
    }
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

  // Where things that make a sound are, for audio.js: the steam vent, the torn poster's corner, the faulty tube, the
  // puddles (in DRIP.period order).
  const sources = {
    vent, poster: flap && { x: flap.mesh.position.x, y: flap.mesh.position.y, z: flap.mesh.position.z }, fault: tubes[flicker] || null,
    puddles: puddles.map((p) => ({ x: p.x, y: p.y, z: p.z })),
  };

  return {
    tubes, owned, pigeons, rats, sources,
    // trainT: the train's (shared) time, for the departures board; time is the station's own.
    update(time, dt, walker, pass, gates = null, trainT = time) {
      placeWalls(walker);
      updateLife(time, dt, walker, pass, gates, trainT);
      stepFaders(walker, dt);
      const passing = !!pass && pass.phase === 'pass' && pass.speed > 0.5, gustK = passing ? Math.min(1, pass.speed / 20) : 0;
      // Tubes: steady, but one has a fault, and the ones near a passing train shudder (spec §5; neither with
      // reduced motion).
      for (let i = 0; i < tubes.length; i++) {
        const t = tubes[i];
        let k = 1;
        if (i === flicker && !reducedMotion) {
          k = tubeFault(time); // a 0.9 s stutter every 4.1 s, and a flick now and then between (sound.js: it crackles)
        }
        if (passing && !reducedMotion && Math.abs(t.x - pass.head) < 4) k *= 1 - gustK * (0.45 - 0.45 * Math.abs(Math.sin(time * 53 + i)));
        t.k = k;
        // A tube between the camera and you (south of you, at any x: the camera is kept inside the map, so it isn't
        // always straight behind you) would float mid-screen, so its bar goes (its light stays).
        t.bar.visible = k > 0.3; // in front of you it fades (stepFaders) rather than going
      }
      // The pool's lights go to the nearest tubes, each at its tube's flicker.
      const near = tubes.map((t, i) => [Math.abs(t.x - walker.x) + Math.abs(t.z - walker.z), i]).sort((a, b) => a[0] - b[0]);
      for (let j = 0; j < tubeLights.length; j++) {
        const t = tubes[near[j][1]];
        tubeLights[j].position.set(t.x, t.y - 0.25, t.z);
        tubeLights[j].intensity = t.base * t.k;
      }
      // The tunnel a train is about to come out of glows for the warning (passFor's 'warn'), and stays lit as it comes.
      const warm = pass && (pass.phase === 'warn' ? pass.warn : pass.phase === 'pass' && pass.speed > 0 && (pass.head < 4 || pass.head > map.cols - 4) ? 1 : 0);
      mouthLight.intensity = 25 * (warm || 0);
      if (warm) mouthLight.position.set(pass.dir > 0 ? 0.3 : map.cols - 0.3, pass.track.y + 1.6, pass.track.z);
      // Dust drifts; a passing train blows it along, and it stirs before. Motes outside the box around you wrap
      // in (all at once on the frame you arrive somewhere new, which is as good as a cut).
      const wind = passing ? pass.dir * 6 * gustK * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 25) : pass && pass.phase === 'warn' ? 0.6 * pass.dir : 0;
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
      // Drips: DRIP.fall seconds falling from the ceiling, then a ripple for DRIP.ring (audio.js plinks as it lands).
      for (let i = 0; i < puddles.length; i++) {
        const p = puddles[i];
        const ph = (time % p.period) / p.period, fallEnd = DRIP.fall / p.period;
        p.drop.visible = ph < fallEnd;
        p.drop.position.set(p.x, p.y + 3.4 * (1 - ph / fallEnd), p.z);
        const rt = (ph - fallEnd) * p.period;
        p.ring.visible = rt > 0 && rt < DRIP.ring;
        p.ring.position.set(p.x, p.y + 0.02, p.z);
        p.ring.scale.setScalar(1 + rt * 7);
        p.ring.material.opacity = 0.8 * (1 - rt / DRIP.ring);
      }
      // The newspaper skitters in the wind where it lies (a train on the far track barely stirs it), and stops
      // at the platform's ends.
      if (news) {
        const nm = news.mesh, [lo, hi] = decor.news.range;
        const stir = passing ? gustK * (Math.abs(pass.track.z - nm.position.z) < 6 ? 1 : 0.3) * Math.max(0, 1 - Math.abs(pass.head - nm.position.x) / 12) : 0;
        if (stir > 0) {
          nm.position.x = Math.min(hi, Math.max(lo, nm.position.x + pass.dir * 3 * stir * dt));
          nm.rotation.z = Math.sin(time * 9) * 0.3 * stir;
        } else nm.rotation.z *= Math.exp(-dt * 6);
      }
    },
    // A very slight shake while a train passes near you (spec §5; none with reduced motion).
    shake(time, walker, pass) {
      if (reducedMotion || !pass || pass.phase !== 'pass' || !(pass.speed > 0.5)) { SHAKE.x = SHAKE.y = 0; return SHAKE; }
      const a = 0.05 * Math.min(1, pass.speed / 20) * Math.max(0, 1 - Math.abs(pass.head - walker.x) / 20);
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
