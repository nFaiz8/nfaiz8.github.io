// The turnstiles drawn (station spec, "Life and props (round 2)"), New York style and generic, in the station's own
// look: matte boxes with a faint glyph on each face (like the benches and the kiosk). Waist-high steel cabinets
// between the lanes; on each lane's north cabinet a three-armed rotor of square bars that you turn a third of a turn
// by walking through, and on its top a flat round tap target, the ◎ puck, whose light ring is dim white idle, green
// while a paid gate is open for you and red a moment when you walk into it locked. No screens, no text. The line's
// southernmost lane is the emergency exit (gates.js): a barred steel swing gate hinged at the wall, the red
// EMERGENCY EXIT / ALARM WILL SOUND sign on the wall over it and the alarm light above that. gates.js holds the
// state; this only draws it.
import * as THREE from 'three';
import { LEVEL } from './map.js';
import { FONT, makeSprite } from './sprites.js';
import { ARM_X, rotorTurns, ringState, alarmOn, gateKinds, HINGE_X, HINGE_IN, SWING_LEN, LANE_IN } from './gates.js';

// A cabinet: its length along the lanes, and its height up to its top slab. Across the lanes it fills its post tile
// and reaches LANE_IN into each gate tile beside it, so a lane is 1 − 2·LANE_IN wide, cabinet to cabinet: room for
// you, and no gap a person could squeeze through. At the line's ends a cabinet runs into the wall.
const CAB = { len: 0.9, h: 0.95 };
const INTO_WALL = 0.3;
// The rotor: its hub stands HUB_OUT off the cabinet's face and its level arm reaches across the lane to a hand's width
// (HAND) short of the next cabinet, as a real tripod turnstile's does.
const HAND = 0.08, HUB_OUT = 0.11;
const HUB_Y = 0.92, ARM = 1 - 2 * LANE_IN - HUB_OUT - HAND, ARM_R = 0.026;
const TILT = Math.PI / 3; // the rotor's axis, down from level into the lane: one arm level, two down along the cabinet

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

// The puck's ring colours (bright enough to bloom when lit), and the alarm light's.
const RING = { idle: new THREE.Color(0.62, 0.64, 0.68), go: new THREE.Color(0.35, 2.1, 0.6), refused: new THREE.Color(2.4, 0.3, 0.22) };
const ALARM_ON = new THREE.Color(2.8, 0.1, 0.05), ALARM_OFF = new THREE.Color(0.22, 0.04, 0.03);
const BLINK = 3; // the alarm light's flashes a second (steady with reduced motion)
const SIGN_Y = 1.62, LAMP_Y = 2.0; // the sign's centre and the alarm light's, over the hall floor

export function buildTurnstiles(scene, map, own, { reducedMotion = false } = {}) {
  const gates = map.cells.filter((cell) => cell.ch === ':');
  if (!gates.length) return { update() {}, signs: [] };
  const kinds = gateKinds(map);
  const y0 = LEVEL.hall;
  const matte = (base, ink, glyph) => own(new THREE.MeshStandardMaterial({ map: own(glyphTexture(base, ink, glyph)), roughness: 0.75, metalness: 0.15 }));
  const steelMat = matte('#7a8290', '#d0d7e2', '═'); // the cabinets' sides: steel, its brushing a faint ═
  const topMat = matte('#8f98a6', '#e1e7f0', '─'); // their tops, the gate's rails and bars
  const darkMat = own(new THREE.MeshStandardMaterial({ color: '#23262d', roughness: 0.85 }));
  const armMat = own(new THREE.MeshStandardMaterial({ color: '#b9c1cc', roughness: 0.55, metalness: 0.2 }));
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const parts = { steel: [], top: [], dark: [] };
  const put = (kind, x, y, z, sx, sy, sz) => parts[kind].push([x, y, z, sx, sy, sz]);

  // Cabinets: one on each post between lanes, and one at each end of the line against the wall, half in it, except
  // beside the emergency gate, which hangs on the wall itself.
  const cabs = new Map(); // its north edge → { z0, z1 }, its extent across the lanes
  const cabAt = (z0, z1) => { if (!cabs.has(z0)) cabs.set(z0, { z0, z1 }); return cabs.get(z0); };
  const lanes = gates.map((cell, i) => {
    const north = map.at(cell.c, cell.r - 1);
    // The lane's north cabinet: a post's, filling its tile, or one running into the wall.
    cabAt(north?.ch === 't' ? cell.r - 1 - LANE_IN : cell.r - INTO_WALL, cell.r + LANE_IN);
    const south = map.at(cell.c, cell.r + 1);
    if (kinds[i] !== 'emergency' && south && south.ch !== 't' && south.ch !== ':') cabAt(cell.r + 1 - LANE_IN, cell.r + 1 + INTO_WALL);
    return { i, cell, face: cell.r + LANE_IN, kind: kinds[i] };
  });
  const c0 = gates[0].c, cx = c0 + 0.04 + CAB.len / 2;
  for (const { z0, z1 } of cabs.values()) {
    const z = (z0 + z1) / 2, w = z1 - z0;
    put('dark', cx, y0 + 0.05, z, CAB.len + 0.02, 0.1, w + 0.02); // kick plate
    put('steel', cx, y0 + 0.1 + (CAB.h - 0.1) / 2, z, CAB.len, CAB.h - 0.1, w);
    put('top', cx, y0 + CAB.h + 0.03, z, CAB.len + 0.03, 0.06, w + 0.03); // the top slab, a little proud
  }

  // The emergency gates: a hinge post at the wall, and on it a swing panel of bars reaching across the lane to the
  // cabinet, waist-to-chest high, with a push bar on the platform side; the sign on the wall over it, facing the
  // camera, and the alarm light above the sign.
  const signs = [], exits = [];
  const H = 1.2; // the panel's height
  for (const lane of lanes.filter((l) => l.kind === 'emergency')) {
    const { c, r } = lane.cell, hx = c + HINGE_X, hz = r + 1 - HINGE_IN, len = SWING_LEN;
    put('steel', hx, y0 + (H + 0.12) / 2, hz, 0.08, H + 0.12, 2 * HINGE_IN); // hinge post, against the wall
    put('dark', hx, y0 + 0.02, hz, 0.14, 0.04, 0.14); // its foot plate
    const panel = new THREE.Group();
    const bar = (x, y, z, sx, sy, sz, mat = topMat) => {
      const m = new THREE.Mesh(unit, mat);
      m.position.set(x, y, z); m.scale.set(sx, sy, sz);
      panel.add(m);
    };
    // Built pointing north (−z) from the hinge; swung, it turns toward the hall (−x).
    bar(0, H - 0.025, -len / 2, 0.05, 0.05, len); // top rail
    bar(0, 0.62, -len / 2, 0.04, 0.04, len); // middle rail
    bar(0, 0.12, -len / 2, 0.04, 0.04, len); // bottom rail
    bar(0, (H + 0.1) / 2, -(len - 0.025), 0.05, H - 0.1, 0.05); // the free stile
    bar(0, (H + 0.1) / 2, -0.04, 0.05, H - 0.1, 0.05); // the hinge stile
    for (let z = 0.13; z < len - 0.06; z += 0.1) bar(0, (H + 0.1) / 2, -z, 0.022, H - 0.14, 0.022); // bars
    bar(0.06, 0.95, -len / 2, 0.035, 0.05, len - 0.2, darkMat); // the push bar, on the platform side
    panel.position.set(hx, y0, hz);
    scene.add(panel);
    // The sign over the gate, on the wall's face, and the alarm light above it: a red lamp in a dark housing.
    const sign = makeSprite(['EMERGENCY EXIT', 'ALARM WILL SOUND'], ['#ffffff', '#ffe7e3'], 0.34, { glow: true, bright: 1.15, bg: '#b3221b', frame: '#ffffff' });
    sign.mesh.position.set(c + 0.5, y0 + SIGN_Y, r + 1 - 0.015);
    scene.add(sign.mesh);
    own(sign);
    signs.push({ mesh: sign.mesh, x: c + 0.5, z: r + 1, side: 1.2 });
    const housing = new THREE.Mesh(unit, darkMat);
    housing.scale.set(0.38, 0.2, 0.1);
    housing.position.set(c + 0.5, y0 + LAMP_Y, r + 1 - 0.08);
    const lampMat = own(new THREE.MeshBasicMaterial({ color: ALARM_OFF.clone(), toneMapped: false }));
    const lamp = new THREE.Mesh(own(new THREE.BoxGeometry(0.3, 0.13, 0.06)), lampMat);
    lamp.position.set(c + 0.5, y0 + LAMP_Y, r + 1 - 0.01); // on the housing's face toward the camera
    const glow = new THREE.PointLight('#ff3a26', 0, 4, 1.4);
    glow.position.set(c + 0.3, y0 + LAMP_Y - 0.2, r + 0.4);
    scene.add(housing, lamp, glow);
    exits.push({ i: lane.i, panel, lampMat, glow });
  }

  const tmp = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (const [kind, list] of Object.entries(parts)) {
    if (!list.length) continue;
    const mesh = new THREE.InstancedMesh(unit, kind === 'steel' ? steelMat : kind === 'top' ? topMat : darkMat, list.length);
    list.forEach(([x, y, z, sx, sy, sz], i) => mesh.setMatrixAt(i, tmp.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz))));
    scene.add(mesh);
  }
  // Light over the line, so the steel reads as steel.
  const zs = [...cabs.values()].flatMap((k) => [k.z0, k.z1]);
  const light = new THREE.PointLight('#dfe8ff', 3, 5.5, 1.6);
  light.position.set(c0 + 0.2, y0 + 2.7, (Math.min(...zs) + Math.max(...zs)) / 2);
  scene.add(light);

  // Rotors and tap targets, one per turnstile lane, on the lane's north cabinet.
  const armGeo = own(new THREE.BoxGeometry(ARM_R * 2, ARM, ARM_R * 2).translate(0, ARM / 2, 0));
  const hubGeo = own(new THREE.BoxGeometry(0.17, 0.16, 0.17));
  const axis = new THREE.Vector3(0, -Math.sin(TILT), Math.cos(TILT)); // into the lane (south) and down
  const level = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
  // The puck: a dark disc flush on the cabinet top, a lit ring and a lit dot in it (◎).
  const discGeo = own(new THREE.CylinderGeometry(0.1, 0.1, 0.014, 28));
  const ringGeo = own(new THREE.RingGeometry(0.058, 0.08, 28).rotateX(-Math.PI / 2));
  const dotGeo = own(new THREE.CircleGeometry(0.022, 16).rotateX(-Math.PI / 2));
  const rotors = lanes.filter((l) => l.kind !== 'emergency').map(({ i, cell, face }) => {
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

    const top = y0 + CAB.h + 0.06, px = cell.c + 0.36, pz = face - 0.13;
    const disc = new THREE.Mesh(discGeo, darkMat);
    disc.position.set(px, top + 0.007, pz);
    const ringMat = own(new THREE.MeshBasicMaterial({ color: RING.idle.clone(), toneMapped: false }));
    const ring = new THREE.Mesh(ringGeo, ringMat), dot = new THREE.Mesh(dotGeo, ringMat);
    ring.position.set(px, top + 0.016, pz);
    dot.position.set(px, top + 0.016, pz);
    scene.add(disc, ring, dot);
    return { i, arms, ringMat, state: 'idle' };
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
        const state = ringState(g, r.i, walker, time);
        if (state !== r.state) { r.state = state; r.ringMat.color.copy(RING[state]); }
      }
      for (const e of exits) {
        const k = g.gates[e.i];
        e.panel.rotation.y = k.swing * (Math.PI / 2);
        // The alarm flashes while it sounds (steady with reduced motion); walking into the gate from the hall gives
        // a short steady red.
        const n = g.note, bumpedIt = n && n.gate === k && time >= n.from && time < n.from + 0.5;
        const on = alarmOn(g, k, time) ? reducedMotion || (time * BLINK) % 1 < 0.6 : bumpedIt;
        e.lampMat.color.copy(on ? ALARM_ON : ALARM_OFF);
        e.glow.intensity = on ? 10 : 0;
      }
    },
  };
}
