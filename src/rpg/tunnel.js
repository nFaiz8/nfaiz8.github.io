// The tunnels (subway ride spec §5): dark brick and concrete, two tracks with a row of steel columns between them, a
// lamp every LAMP tiles on the outer walls, red and green signals, cables. No ceiling, as the station has none, so the
// tilted camera sees in. Drawn as a run of segments that follows the camera; a segment shows only where the line is a
// tunnel, so the stations and the bridge are left to themselves.
import * as THREE from 'three';
import { pieceAt, LAMP, TRACKS } from './line.js';
import { LEVEL } from './map.js';

const SEGS = 40; // 480 tiles: well past the fog either way
const WALL_H = 5.2;
const LIGHTS = 4; // point lights at the lamps nearest the camera

function glyphs(base, ink, glyph, repeat) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, 64, 64);
  g.fillStyle = ink; g.font = '28px monospace'; g.textAlign = 'center'; g.globalAlpha = 0.35; g.fillText(glyph, 32, 42);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
}

export function createTunnel(scene, { reducedMotion = false } = {}) {
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const mats = {
    wall: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#2a2622', '#7a6a58', '▦', [LAMP, WALL_H])), roughness: 0.95 })),
    bed: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#1f1c18', '#6a5a48', '═', [LAMP, 3])), roughness: 1 })),
    middle: own(new THREE.MeshStandardMaterial({ map: own(glyphs('#24221f', '#5a5048', '·', [LAMP, 9])), roughness: 1 })),
    column: own(new THREE.MeshStandardMaterial({ color: '#3a3f4f', metalness: 0.4, roughness: 0.6 })),
    rail: own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 })),
    cable: own(new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.8 })),
    lamp: own(new THREE.MeshBasicMaterial({ color: '#ffe9c0', toneMapped: false })),
    red: own(new THREE.MeshBasicMaterial({ color: '#ff3020', toneMapped: false })),
    green: own(new THREE.MeshBasicMaterial({ color: '#30ff70', toneMapped: false })),
  };
  // Per segment: [material, x offset in the segment, y, z, sx, sy, sz] boxes.
  const zN = 0.5, zS = 18.5, y0 = LEVEL.track;
  const parts = [
    ['wall', LAMP / 2, y0 + WALL_H / 2 - 0.2, zN - 0.15, LAMP, WALL_H, 0.3],
    ['wall', LAMP / 2, y0 + WALL_H / 2 - 0.2, zS + 0.15, LAMP, WALL_H, 0.3],
    ['middle', LAMP / 2, y0 + 0.5, 9.5, LAMP, 1.0, 9.4],
    ...TRACKS.map((t) => ['bed', LAMP / 2, y0 - 0.1, t.z, LAMP, 0.2, 3.6]),
    ...TRACKS.flatMap((t) => [-0.72, 0.72].map((dz) => ['rail', LAMP / 2, y0 + 0.06, t.z + dz, LAMP, 0.12, 0.1])),
    ...[0, 4, 8].map((u) => ['columnN', u + 0.2, y0 + 2.3, 4.6, 0.3, 4.6, 0.3]),
    ...[0, 4, 8].map((u) => ['columnS', u + 0.2, y0 + 2.3, 14.4, 0.3, 4.6, 0.3]),
    ['cable', LAMP / 2, y0 + 3.2, zN + 0.05, LAMP, 0.06, 0.06], ['cable', LAMP / 2, y0 + 3.0, zN + 0.05, LAMP, 0.06, 0.06],
    ['cable', LAMP / 2, y0 + 3.2, zS - 0.05, LAMP, 0.06, 0.06],
    ['lamp', 0, y0 + 3.6, zN + 0.12, 0.5, 0.12, 0.1], ['lamp', 0, y0 + 3.6, zS - 0.12, 0.5, 0.12, 0.1],
  ];
  const byMat = {};
  for (const p of parts) (byMat[p[0]] ||= []).push(p);
  const meshes = Object.entries(byMat).map(([k, list]) => {
    const m = new THREE.InstancedMesh(unit, mats[k.startsWith('column') ? 'column' : k], list.length * SEGS);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    scene.add(m);
    return { k, m, list };
  });
  // Signals every 5th segment on the column line, red or green from a hash of the segment.
  const signals = ['red', 'green'].map((k) => { const m = new THREE.InstancedMesh(own(new THREE.SphereGeometry(0.09, 8, 6)), mats[k], SEGS); m.frustumCulled = false; scene.add(m); return m; });
  const lights = Array.from({ length: LIGHTS }, () => { const l = new THREE.PointLight('#ffd9a8', 0, 9, 1.6); scene.add(l); return l; });

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), ZERO = new THREE.Vector3(0, 0, 0);
  let lastFirst = null, on = 0; // on: segments drawn (for tests)
  return {
    // meZ, camZ: you and the camera; the row of columns between them is hidden, or it would stand across your car.
    update(camX, time, meZ = 9.5, camZ = 30) {
      for (const { k, m } of meshes) if (k.startsWith('column')) { const z = k === 'columnN' ? 4.6 : 14.4; m.visible = !(z > meZ && z < camZ); }
      const first = Math.floor(camX / LAMP) - SEGS / 2;
      if (first !== lastFirst) {
        lastFirst = first;
        on = 0;
        for (let n = 0; n < SEGS; n++) if (pieceAt((first + n) * LAMP + LAMP / 2).kind === 'tunnel') on++;
        for (const { m, list } of meshes) {
          let i = 0;
          for (let n = 0; n < SEGS; n++) {
            const x0 = (first + n) * LAMP, on = pieceAt(x0 + LAMP / 2).kind === 'tunnel';
            for (const [, ox, y, z, sx, sy, sz] of list) {
              m4.compose(v.set(x0 + ox, y, z), q, on ? s.set(sx, sy, sz) : ZERO);
              m.setMatrixAt(i++, m4);
            }
          }
          m.instanceMatrix.needsUpdate = true;
        }
        signals.forEach((m, k) => {
          for (let n = 0; n < SEGS; n++) {
            const seg = first + n, x0 = seg * LAMP, on = pieceAt(x0).kind === 'tunnel' && seg % 5 === 0 && ((seg * 2654435761) >>> 0) % 2 === k;
            m4.compose(v.set(x0 + 0.2, LEVEL.track + 3.0, 4.3), q, on ? s.set(1, 1, 1) : ZERO);
            m.setMatrixAt(n, m4);
          }
          m.instanceMatrix.needsUpdate = true;
        });
      }
      // The lights go to the lamps nearest the camera, north and south walls in turn.
      const c = Math.round(camX / LAMP);
      for (let j = 0; j < LIGHTS; j++) {
        const x = (c + Math.floor(j / 2) * (j % 4 < 2 ? 1 : -1)) * LAMP, z = j % 2 ? zS - 0.6 : zN + 0.6;
        const on = pieceAt(x).kind === 'tunnel';
        lights[j].position.set(x, LEVEL.track + 3.3, z);
        lights[j].intensity = on ? 5 * (reducedMotion ? 1 : 0.96 + 0.04 * Math.sin(time * 9 + j)) : 0;
      }
    },
    shown: () => on,
    dispose() {
      for (const { m } of meshes) { m.removeFromParent(); m.dispose(); }
      for (const m of signals) { m.removeFromParent(); m.dispose(); }
      for (const l of lights) l.removeFromParent();
      for (const o of owned) o.dispose();
    },
  };
}
