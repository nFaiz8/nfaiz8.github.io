// The turnstiles drawn (station spec, "Life and props (round 2)"), New York style and generic, in the station's own
// look: matte boxes with a faint glyph on each face (like the benches and the kiosk), lit signs as glowing panels
// (like the departures board). Waist-high steel cabinets between the lanes; on each lane's north cabinet a
// three-armed rotor of square bars that you turn a third of a turn by walking through, and on its top a reader, an
// LED panel with the tap mark ◎, leaning toward its lane and the camera. At the line's north end, where a wall tile
// has hall floor west of it, an emergency exit gate stands in a recess with its sign over it. gates.js holds the
// state; this only draws it.
import * as THREE from 'three';
import { LEVEL } from './map.js';
import { FONT, makeSprite } from './sprites.js';
import { ARM_X, rotorTurns, readerText, READER } from './gates.js';

const CAB = { w: 0.5, len: 0.9, h: 0.95 }; // a cabinet: across the lanes, along them, up to its top slab
const HUB_Y = 0.92, ARM = 0.62, ARM_R = 0.026, HUB_OUT = 0.11; // the hub stands HUB_OUT off the cabinet's face
const TILT = Math.PI / 3; // the rotor's axis, down from level into the lane: one arm level, two down along the cabinet
export const LINTEL = 2.0; // the emergency gate's recess is open up to here

// The wall tile at the north end of a column of gates with hall floor west of it, if any: the emergency gate's spot.
export function emergencyTile(map) {
  const gate = map.cells.find((c) => c.ch === ':');
  if (!gate) return null;
  const c = gate.c;
  let r = gate.r;
  while (map.at(c, r - 1)?.ch === ':' || map.at(c, r - 1)?.ch === 't') r--;
  const end = map.at(c, r - 1), west = map.at(c - 1, r - 1);
  return end && end.ch === '#' && west && west.walk && west.level === LEVEL.hall ? { c, r: r - 1 } : null;
}

// A face texture as the station's other boxes have: a base colour with one faint glyph.
function glyphTexture(base, ink, glyph, alpha = 0.35) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  g.globalAlpha = alpha; g.fillStyle = ink;
  g.font = `${64 * 0.8}px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(glyph, 32, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// The LED display's text, fitted: the fewest lines (up to three) that give the biggest letters, so GO is big and
// SWIPE AGAIN AT THIS TURNSTILE still fits. Pure, for the tests.
export function ledLines(text, cols = 14) {
  const words = text.split(' ');
  let best = null;
  for (let n = 1; n <= 3; n++) {
    // Greedy wrap into lines no longer than the widest word, aiming for n lines of even length.
    const target = Math.max(...words.map((w) => w.length), Math.ceil(text.length / n));
    const lines = [];
    for (const w of words) {
      const last = lines.at(-1);
      if (last != null && last.length + 1 + w.length <= target) lines[lines.length - 1] = `${last} ${w}`;
      else lines.push(w);
    }
    if (lines.length > n) continue;
    const width = Math.max(...lines.map((l) => l.length));
    const size = Math.min(1 / lines.length, (cols / Math.max(width, 4)) * (1 / 3)); // letter height as a share of the panel
    if (!best || size > best.size + 1e-9) best = { lines, size };
  }
  return best.lines;
}

// The reader's panel: black, framed in a dim line of its colour like the departures board, the tap mark ◎ at its
// left (lit to show the reader's state) and the LED text beside it.
const LED_W = 336, LED_H = 112, MARK = 70;
function drawLed(g, text, color, mark) {
  g.fillStyle = '#050403'; g.fillRect(0, 0, LED_W, LED_H);
  g.globalAlpha = 0.45; g.strokeStyle = color; g.lineWidth = 4; g.strokeRect(5, 5, LED_W - 10, LED_H - 10);
  g.globalAlpha = 1;
  g.font = `700 66px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = mark;
  g.fillText('◎', 10 + MARK / 2, LED_H / 2 + 3);
  const lines = ledLines(text);
  const width = Math.max(...lines.map((l) => l.length), 4), room = LED_W - MARK - 22;
  const px = Math.min((LED_H - 22) / lines.length / 1.05, room / width / 0.6);
  g.font = `700 ${px}px ${FONT}`; g.fillStyle = color;
  lines.forEach((l, i) => g.fillText(l, MARK + 10 + room / 2, LED_H / 2 + (i - (lines.length - 1) / 2) * px * 1.05 + 2));
}

const AMBER = '#ffb340', GREEN = '#6dff8c', RED = '#ff5a4a', IDLE = '#8fc4ff';
const tone = (text) => (text === READER.go ? GREEN : text === READER.fare || text === READER.used ? RED : AMBER);

export function buildTurnstiles(scene, map, own, { reducedMotion = false } = {}) {
  const gates = map.cells.filter((cell) => cell.ch === ':');
  if (!gates.length) return { update() {}, faders: [] };
  const y0 = LEVEL.hall;
  const matte = (base, ink, glyph) => own(new THREE.MeshStandardMaterial({ map: own(glyphTexture(base, ink, glyph)), roughness: 0.75, metalness: 0.15 }));
  const steelMat = matte('#7a8290', '#d0d7e2', '═'); // the cabinets' sides: steel, its brushing a faint ═
  const topMat = matte('#8f98a6', '#e1e7f0', '─'); // their tops, the gate's rails and bars
  const darkMat = own(new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.85 }));
  const armMat = own(new THREE.MeshStandardMaterial({ color: '#b9c1cc', roughness: 0.55, metalness: 0.2 }));
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const parts = { steel: [], top: [], dark: [] };
  const put = (kind, x, y, z, sx, sy, sz) => parts[kind].push([x, y, z, sx, sy, sz]);

  // Cabinets: one on each post between lanes, and one at each end of the line against the wall, half in it.
  const cabs = new Map(); // centre z → { z }
  const cabAt = (z) => { if (!cabs.has(z)) cabs.set(z, { z }); return cabs.get(z); };
  const lanes = gates.map((cell) => {
    const north = map.at(cell.c, cell.r - 1);
    const cab = cabAt(north?.ch === 't' ? cell.r - 0.5 : cell.r);
    const south = map.at(cell.c, cell.r + 1);
    if (south && south.ch !== 't' && south.ch !== ':') cabAt(cell.r + 1);
    return { cell, cab, face: cab.z + CAB.w / 2 };
  });
  const c0 = gates[0].c, cx = c0 + 0.04 + CAB.len / 2;
  for (const { z } of cabs.values()) {
    put('dark', cx, y0 + 0.05, z, CAB.len + 0.02, 0.1, CAB.w + 0.02); // kick plate
    put('steel', cx, y0 + 0.1 + (CAB.h - 0.1) / 2, z, CAB.len, CAB.h - 0.1, CAB.w);
    put('top', cx, y0 + CAB.h + 0.03, z, CAB.len + 0.03, 0.06, CAB.w + 0.03); // the top slab, a little proud
  }

  // The emergency exit gate, in its recess at the north end: a hinge post at the wall, a latch post by the end
  // cabinet, and between them a swing panel of bars, left a little ajar (as they often are), with the sign over it
  // on the lintel. Closed it would be edge-on to the camera; ajar, you see its bars.
  const exitTile = emergencyTile(map);
  const signs = [];
  if (exitTile) {
    const { c, r } = exitTile, gx = c + 0.12, z1 = r + 0.06, z2 = r + 1 - CAB.w / 2 - 0.03, h = 1.1, len = z2 - z1 - 0.06;
    put('steel', gx, y0 + h / 2 + 0.05, z1, 0.08, h + 0.1, 0.08); // hinge post
    put('steel', gx, y0 + h / 2 + 0.05, z2, 0.07, h + 0.1, 0.07); // latch post
    put('dark', gx + 0.03, y0 + 0.9, z2 - 0.06, 0.1, 0.16, 0.08); // the alarm box on the latch
    const panel = new THREE.Group(), bar = (x, y, z, sx, sy, sz, mat = topMat) => {
      const m = new THREE.Mesh(unit, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      panel.add(m);
    };
    bar(0, h - 0.02, len / 2, 0.05, 0.05, len); // top rail
    bar(0, 0.6, len / 2, 0.04, 0.04, len); // middle rail
    bar(0, 0.14, len / 2, 0.04, 0.04, len); // bottom rail
    bar(0, (h + 0.12) / 2, len - 0.02, 0.05, h - 0.1, 0.05); // the free stile
    for (let z = 0.1; z < len - 0.06; z += 0.1) bar(0, (h + 0.12) / 2, z, 0.022, h - 0.14, 0.022); // bars
    bar(-0.06, 0.88, len / 2, 0.04, 0.05, len - 0.16, darkMat); // the push bar, on the hall side
    panel.position.set(gx, y0, z1 + 0.03);
    panel.rotation.y = 0.42; // ajar, its free end swung in toward the recess
    scene.add(panel);
    // The alarm's red light on the latch, and a little red glow in the recess.
    const alarm = new THREE.Mesh(own(new THREE.BoxGeometry(0.07, 0.05, 0.07)), own(new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 0.3, 0.2), toneMapped: false })));
    alarm.position.set(gx + 0.03, y0 + 1.01, z2 - 0.08);
    const glow = new THREE.PointLight('#ff6050', 1.6, 1.8, 1.6);
    glow.position.set(c + 0.45, y0 + 1.3, r + 0.5);
    scene.add(alarm, glow);
    const sign = makeSprite(['EMERGENCY EXIT', 'ALARM WILL SOUND'], ['#ffffff', '#ffe7e3'], 0.36, { glow: true, bright: 1.15, bg: '#b3221b', frame: '#ffffff' });
    sign.mesh.position.set(c + 0.5, y0 + LINTEL + 0.03, r + 1.015);
    scene.add(sign.mesh);
    own(sign);
    signs.push({ mesh: sign.mesh, x: c + 0.5, z: r + 1, side: 1.2 });
  }

  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const [kind, list] of Object.entries(parts)) {
    const mesh = new THREE.InstancedMesh(unit, kind === 'steel' ? steelMat : kind === 'top' ? topMat : darkMat, list.length);
    list.forEach(([x, y, z, sx, sy, sz], i) => mesh.setMatrixAt(i, tmp.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))));
    scene.add(mesh);
  }
  // Light over the line, so the steel reads as steel.
  const zs = [...cabs.keys()];
  const light = new THREE.PointLight('#dfe8ff', 3, 5.5, 1.6);
  light.position.set(c0 + 0.2, y0 + 2.7, (Math.min(...zs) + Math.max(...zs)) / 2);
  scene.add(light);

  // Rotors and readers, one per lane, on the lane's north cabinet.
  const armGeo = own(new THREE.BoxGeometry(ARM_R * 2, ARM, ARM_R * 2).translate(0, ARM / 2, 0));
  const hubGeo = own(new THREE.BoxGeometry(0.17, 0.16, 0.17));
  const axis = new THREE.Vector3(0, -Math.sin(TILT), Math.cos(TILT)); // into the lane (south) and down
  const level = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  const ledGeo = own(new THREE.PlaneGeometry(0.76, 0.76 * (LED_H / LED_W)));
  const headGeo = own(new THREE.BoxGeometry(0.8, 0.29, 0.05));
  const rotors = lanes.map(({ cell, face }, i) => {
    const hub = new THREE.Group();
    hub.position.set(cell.c + ARM_X, y0 + HUB_Y, face + HUB_OUT);
    const housing = new THREE.Mesh(hubGeo, darkMat);
    housing.quaternion.setFromUnitVectors(up, axis);
    housing.position.copy(axis).multiplyScalar(-0.06);
    hub.add(housing);
    const arms = [0, 1, 2].map(() => {
      const m = new THREE.Mesh(armGeo, armMat);
      hub.add(m);
      return m;
    });
    scene.add(hub);

    // The reader: its panel on a dark back, leaning back on the cabinet's top toward the lane.
    const head = new THREE.Group();
    head.position.set(cell.c + 0.49, y0 + CAB.h + 0.18, face - 0.14);
    head.rotation.x = -0.75;
    const back = new THREE.Mesh(headGeo, darkMat);
    const ledCanvas = document.createElement('canvas');
    ledCanvas.width = LED_W; ledCanvas.height = LED_H;
    const ledTex = own(new THREE.CanvasTexture(ledCanvas));
    ledTex.colorSpace = THREE.SRGBColorSpace;
    ledTex.anisotropy = 4;
    const led = new THREE.Mesh(ledGeo, own(new THREE.MeshBasicMaterial({ map: ledTex, color: new THREE.Color(1.35, 1.35, 1.35), toneMapped: false })));
    led.position.z = 0.026;
    head.add(back, led);
    scene.add(head);
    return { i, cell, arms, ledG: ledCanvas.getContext('2d'), ledTex, key: '', text: '' };
  });

  // Point each rotor's arms: the level one is turned `turns` thirds about the axis (east positive).
  const aim = (r, turns) => {
    for (let j = 0; j < 3; j++) {
      const a = -(turns + j) * ((Math.PI * 2) / 3); // a positive turn about the axis moves the level arm's tip west
      dir.copy(level).applyAxisAngle(axis, a);
      r.arms[j].quaternion.setFromUnitVectors(up, dir);
    }
  };
  for (const r of rotors) aim(r, 0);

  return {
    signs,
    update(time, walker, g) {
      if (!g) return;
      for (const r of rotors) {
        aim(r, rotorTurns(g.gates[r.i]));
        // The text, and the tap mark: the idle colour, green for GO, red when refused, and blinking amber while
        // it asks you to swipe again (steady with reduced motion). Redrawn only when either changes.
        const text = readerText(g, r.i, walker, time);
        const blink = text === READER.again && !reducedMotion && Math.floor(time * 6) % 2 === 1;
        const mark = text === READER.tap || text === READER.swipe ? IDLE : blink ? '#3a2a10' : tone(text);
        const key = `${text}|${mark}`;
        if (key !== r.key) { r.key = key; r.text = text; drawLed(r.ledG, text, tone(text), mark); r.ledTex.needsUpdate = true; }
      }
    },
  };
}
