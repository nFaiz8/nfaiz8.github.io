// The bridge (subway ride spec §5): the train on the lower deck of a steel truss over a river at golden hour, a city
// on both banks receding north, towers with lit windows, haze, a low sun from the south-west raking through the
// truss. The sun's shafts in the cars are trainmesh.js's (line.js says where the truss shades them).
import * as THREE from 'three';
import { PIECES, TRUSS, TRACKS } from './line.js';
import { rng } from './life.js';
import { LEVEL } from './map.js';

const B = PIECES.find((p) => p.kind === 'bridge');
const RIVER = [B.x0 + 40, B.x1 - 40]; // the water's banks along x
const GROUND = -24, WATER = -32;
const TOWERS = 320;
const DARK = new THREE.Color('#05060a'), SKY = new THREE.Color('#d7935e'), HAZE = new THREE.Color('#c98a5e');

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

export function createBridge(scene, { reducedMotion = false } = {}) {
  const owned = [], own = (x) => { owned.push(x); return x; };
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  const unit = own(new THREE.BoxGeometry(1, 1, 1));
  const steel = own(new THREE.MeshStandardMaterial({ color: '#5d6a7a', metalness: 0.5, roughness: 0.5 }));
  const nearSteel = own(steel.clone()); nearSteel.transparent = true; // the south truss, between camera and train
  const deckMat = own(new THREE.MeshStandardMaterial({ map: own(canvasTex(64, 64, (g) => { g.fillStyle = '#26231f'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#7a6a55'; g.font = '28px monospace'; g.fillText('═', 16, 42); }, [B.x1 - B.x0, 19])), roughness: 1 }));
  const box = (mat, x, y, z, sx, sy, sz, parent = group) => { const m = new THREE.Mesh(unit, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); parent.add(m); return m; };

  // The deck, the beds and rails.
  box(deckMat, (B.x0 + B.x1) / 2, LEVEL.track - 0.35, 9.5, B.x1 - B.x0, 0.5, 19.5);
  for (const t of TRACKS) for (const dz of [-0.72, 0.72]) box(own(new THREE.MeshStandardMaterial({ color: '#8a8f99', metalness: 0.6, roughness: 0.4 })), (B.x0 + B.x1) / 2, LEVEL.track + 0.06, t.z + dz, B.x1 - B.x0, 0.12, 0.1);
  // The truss, both sides: posts every bay, top and bottom chords, an X of braces in each bay.
  const TOP = LEVEL.track + 9, bays = Math.floor((B.x1 - B.x0) / TRUSS.bay);
  const post = own(new THREE.InstancedMesh(unit, steel, (bays + 1) * 2)), brace = own(new THREE.InstancedMesh(unit, steel, bays * 2 * 2));
  const postS = own(new THREE.InstancedMesh(unit, nearSteel, bays + 1)), braceS = own(new THREE.InstancedMesh(unit, nearSteel, bays * 2));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), s = new THREE.Vector3(), e = new THREE.Euler();
  let pi = 0, bi = 0, ps = 0, bs = 0;
  const diag = Math.hypot(TRUSS.bay, TOP - LEVEL.track), ang = Math.atan2(TOP - LEVEL.track, TRUSS.bay);
  for (const [z, south] of [[-0.2, false], [19.2, true]]) {
    for (let i = 0; i <= bays; i++) {
      m4.compose(v.set(B.x0 + i * TRUSS.bay + TRUSS.post / 2, (LEVEL.track + TOP) / 2, z), q.identity(), s.set(TRUSS.post, TOP - LEVEL.track, TRUSS.post));
      (south ? postS : post).setMatrixAt(south ? ps++ : pi++, m4);
    }
    for (let i = 0; i < bays; i++) for (const sign of [1, -1]) {
      m4.compose(v.set(B.x0 + (i + 0.5) * TRUSS.bay, (LEVEL.track + TOP) / 2, z), q.setFromEuler(e.set(0, 0, sign * ang)), s.set(diag, 0.3, 0.3));
      (south ? braceS : brace).setMatrixAt(south ? bs++ : bi++, m4);
    }
    box(south ? nearSteel : steel, (B.x0 + B.x1) / 2, TOP, z, B.x1 - B.x0, 0.6, 0.6);
    box(south ? nearSteel : steel, (B.x0 + B.x1) / 2, LEVEL.track - 0.3, z, B.x1 - B.x0, 0.6, 0.6);
  }
  group.add(post, brace, postS, braceS);
  // The suspension towers and the main cables, and stone anchorages where the tunnels come out.
  const stone = own(new THREE.MeshStandardMaterial({ color: '#6e6258', roughness: 0.9 }));
  for (const x of [RIVER[0] + 8, RIVER[1] - 8]) for (const z of [-2.5, 21.5]) box(z < 0 ? steel : nearSteel, x, (WATER + 48) / 2, z, 3, 48 - WATER, 3);
  for (const x of [B.x0 - 6, B.x1 + 6]) box(stone, x, (GROUND + 6) / 2, 9.5, 14, 6 - GROUND, 30);
  for (const z of [-2.5, 21.5]) {
    const pts = [];
    for (let i = 0; i <= 40; i++) { const x = B.x0 + ((B.x1 - B.x0) * i) / 40, k = (x - (RIVER[0] + RIVER[1]) / 2) / ((RIVER[1] - RIVER[0]) / 2); pts.push(new THREE.Vector3(x, 8 + 38 * Math.min(1, k * k), z)); }
    group.add(new THREE.Line(own(new THREE.BufferGeometry().setFromPoints(pts)), own(new THREE.LineBasicMaterial({ color: '#2a2f38' }))));
  }
  // The river and the banks.
  const water = own(new THREE.MeshStandardMaterial({ map: own(canvasTex(64, 64, (g) => { g.fillStyle = '#1b2a3a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#e0a060'; g.globalAlpha = 0.4; g.font = '24px monospace'; g.fillText('~', 8, 30); g.fillText('~', 36, 58); }, [80, 200])), roughness: 0.3, metalness: 0.2 }));
  // The river runs north to downtown: it ends at the far bank there.
  const plane = (mat, x0, x1, z0, z1, y) => { const m = new THREE.Mesh(own(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2)), mat); m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); group.add(m); };
  plane(water, RIVER[0] - 50, RIVER[1] + 50, -300, 300, WATER);
  const bank = own(new THREE.MeshStandardMaterial({ color: '#3a3430', roughness: 1 }));
  plane(bank, B.x0 - 900, RIVER[0], -900, 300, GROUND);
  plane(bank, RIVER[1], B.x1 + 900, -900, 300, GROUND);
  plane(bank, RIVER[0] - 50, RIVER[1] + 50, -900, -300, GROUND); // downtown's shore
  // The skyline: towers on both banks, mostly north (where the camera looks), taller and denser further off, with lit
  // windows painted into one texture (instance colours vary the stone). One draw.
  const windowsTex = own(canvasTex(64, 128, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 3; x < w; x += 7) { g.fillStyle = r() < 0.38 ? (r() < 0.7 ? '#ffcf7a' : '#fff0d0') : '#0a0a0a'; g.fillRect(x, y, 4, 5); }
  }, [3, 6]));
  const facade = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveMap: windowsTex, emissiveIntensity: 0.9, roughness: 0.8, metalness: 0.1 }));
  const towers = own(new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), facade, TOWERS));
  const r = rng(42), col = new THREE.Color();
  for (let i = 0; i < TOWERS; i++) {
    // A third are downtown, across the river's far end, where the camera looks up the water; the rest line the banks.
    const downtown = i % 3 === 0, west = r() < 0.5, north = r() < 0.85;
    const x = downtown ? (RIVER[0] + RIVER[1]) / 2 + (r() - 0.5) * 900 : west ? RIVER[0] - 10 - r() * 700 : RIVER[1] + 10 + r() * 700;
    const z = downtown ? -320 - r() * 260 : north ? -30 - r() * 650 : 40 + r() * 250;
    const far = Math.min(1, -z / 650), hgt = (downtown ? 40 : 12) + r() * (40 + 110 * far) * (r() < 0.08 ? 2.2 : 1);
    const wd = 8 + r() * 16;
    m4.compose(v.set(x, GROUND, z), q.identity(), s.set(wd, hgt, 8 + r() * 16));
    towers.setMatrixAt(i, m4);
    towers.setColorAt(i, col.setHSL(0.07 + r() * 0.05, 0.15 + r() * 0.2, 0.25 + r() * 0.3));
  }
  group.add(towers);
  // The sky: a gradient on a far plane that follows the camera along x.
  const skyTex = own(canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1f2a48'); grd.addColorStop(0.55, '#b0607a'); grd.addColorStop(0.82, '#ffb36b'); grd.addColorStop(1, '#ffd9a0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }));
  const sky = new THREE.Mesh(own(new THREE.PlaneGeometry(3000, 700)), own(new THREE.MeshBasicMaterial({ map: skyTex, fog: false, toneMapped: false })));
  sky.position.set(0, 300 + GROUND, -950);
  group.add(sky);
  const sun = new THREE.DirectionalLight('#ffc27a', 0);
  scene.add(sun, sun.target);

  return {
    update(camX, camZ, time) {
      // k: how far the camera is out on the bridge, easing over 30 tiles from each anchorage.
      const k = Math.max(0, Math.min(1, Math.min(camX - (B.x0 - 10), B.x1 + 10 - camX) / 30));
      group.visible = camX > B.x0 - 160 && camX < B.x1 + 160;
      scene.background.lerpColors(DARK, SKY, k);
      scene.fog.color.lerpColors(DARK, HAZE, k);
      scene.fog.near = 16 + (160 - 16) * k;
      scene.fog.far = 34 + (1500 - 34) * k;
      sun.intensity = 2.6 * k;
      sun.position.set(camX - 220, 70, 420);
      sun.target.position.set(camX, LEVEL.track, 9.5);
      sky.position.x = camX;
      nearSteel.opacity = camZ > 19.2 ? 0.25 : 1; // the south truss fades when it's between the camera and you
      nearSteel.depthWrite = nearSteel.opacity > 0.95;
      if (!reducedMotion) water.map.offset.y = (time * 0.01) % 1;
      return k;
    },
    dispose() {
      group.removeFromParent(); sun.removeFromParent(); sun.target.removeFromParent();
      for (const o of owned) o.dispose?.();
    },
  };
}
