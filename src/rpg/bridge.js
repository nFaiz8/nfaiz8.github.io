// The bridge (subway ride spec §5): the train on the lower deck of a steel truss over a river at golden hour, a city
// on both banks receding north, towers with lit windows, haze, a low sun from the south-west raking through the
// truss. The sun's shafts in the cars are trainmesh.js's (line.js says where the truss shades them).
import * as THREE from 'three';
import { PIECES, TRUSS, TRACKS } from './line.js';
import { rng } from './life.js';
import { buildCity, SHORES, parkCorners, lonLat, SCALE, GRID_YAW } from './city.js';
import { LEVEL } from './map.js';

const B = PIECES.find((p) => p.kind === 'bridge');
const RIVER = [B.x0 + 20, B.x1 - 20]; // the water's banks along x
const GROUND = -24, WATER = -32;
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
  // New York (city.js, from real coordinates): water everywhere, the shores over it, every building on its block.
  // The water (Faiz: an ASCII texture, and alive): rows of wave glyphs in blues with the sunset caught in a few, on a
  // surface that swells in gentle overlapping waves (moved in the vertex shader, so it costs nothing per frame here),
  // the glyphs drifting downstream.
  const waveTex = own(canvasTex(128, 128, (g, w, h) => {
    const r = rng(11), glyphs = ['~', '≈', '∽', '-', '~', '·'];
    g.fillStyle = '#2a5578'; g.fillRect(0, 0, w, h);
    g.font = 'bold 16px monospace'; g.textAlign = 'center';
    for (let y = 12; y < h + 8; y += 16) for (let x = 6 + (y % 32 ? 8 : 0); x < w; x += 16) {
      const k = r();
      g.fillStyle = k < 0.12 ? '#ffd09a' : k < 0.55 ? '#9cc4e4' : '#5d8cb4';
      g.fillText(glyphs[Math.floor(r() * glyphs.length)], x, y);
    }
  }, [320, 290]));
  waveTex.anisotropy = 8;
  const glintTex = own(canvasTex(128, 128, (g, w, h) => {
    const r = rng(12);
    // The water's own faint glow (so it reads blue in the dusk), with the sunset caught in a few of its glyphs.
    g.fillStyle = '#0c2236'; g.fillRect(0, 0, w, h);
    g.font = 'bold 16px monospace'; g.textAlign = 'center';
    for (let y = 12; y < h + 8; y += 16) for (let x = 6 + (y % 32 ? 8 : 0); x < w; x += 16) { const k = r(); g.fillStyle = k < 0.1 ? '#ffb870' : '#2e5a80'; g.fillText('~', x, y); }
  }, [320, 290]));
  glintTex.anisotropy = 8;
  const water = own(new THREE.MeshStandardMaterial({ map: waveTex, emissiveMap: glintTex, emissive: '#ffffff', emissiveIntensity: 0.8, roughness: 0.3, metalness: 0.3 }));
  const waves = { value: 0 };
  water.onBeforeCompile = (sh) => {
    sh.uniforms.uWaves = waves;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWaves;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vec4 wp = modelMatrix * vec4(position, 1.0);
        transformed.z += 0.55 * sin(wp.x * 0.07 + uWaves * 1.1) + 0.4 * sin(wp.z * 0.11 - uWaves * 0.8) + 0.2 * sin((wp.x + wp.z) * 0.23 + uWaves * 1.9);`);
  };
  {
    // Laid flat by the mesh's rotation, so the plane's own z (where the shader pushes the swell) is world up.
    const m = new THREE.Mesh(own(new THREE.PlaneGeometry(6000, 5500, 240, 220)), water);
    m.rotation.x = -Math.PI / 2;
    m.position.set(500, WATER, -1250);
    group.add(m);
  }
  // The land: dark asphalt (the streets show between the buildings); Central Park green.
  const asphalt = own(new THREE.MeshStandardMaterial({ map: own(canvasTex(64, 64, (g) => { g.fillStyle = '#2b2826'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#6a5e50'; g.font = '20px monospace'; g.globalAlpha = 0.5; g.fillText('·', 10, 24); g.fillText('·', 40, 52); }, [300, 300])), roughness: 1, side: THREE.DoubleSide }));
  const grass = own(new THREE.MeshStandardMaterial({ color: '#3d5a32', emissive: '#0d1a0a', roughness: 1, side: THREE.DoubleSide }));
  const land = (pts, mat, y) => {
    const shape = new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.z))); // shape y → world −z once laid flat
    const m = new THREE.Mesh(own(new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2)), mat);
    m.position.y = y;
    group.add(m);
  };
  land(SHORES.manhattan, asphalt, GROUND);
  land(SHORES.east, asphalt, GROUND);
  land(SHORES.roosevelt, asphalt, GROUND);
  land(parkCorners(), grass, GROUND + 0.05);
  // The buildings, lit windows painted into one texture (instance colours vary the stone, glass and brick). One draw.
  const windowsTex = own(canvasTex(64, 128, (g, w, h) => {
    const r = rng(7);
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let y = 4; y < h; y += 8) for (let x = 3; x < w; x += 7) { g.fillStyle = r() < 0.38 ? (r() < 0.7 ? '#ffcf7a' : '#fff0d0') : '#0a0a0a'; g.fillRect(x, y, 4, 5); }
  }, [2, 4]));
  const facade = own(new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveMap: windowsTex, emissiveIntensity: 0.7, roughness: 0.8, metalness: 0.1 }));
  const { lots, landmarks } = buildCity();
  const parts = lots.length + landmarks.reduce((a, l) => a + l.tiers.length, 0);
  const towers = own(new THREE.InstancedMesh(own(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0)), facade, parts));
  const r = rng(43), col = new THREE.Color(), turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), GRID_YAW);
  let n = 0;
  const put = (x, z, w, h, d, c) => { m4.compose(v.set(x, GROUND, z), turn, s.set(w, h, d)); towers.setMatrixAt(n, m4); towers.setColorAt(n++, c); };
  for (const l of lots) {
    // Manhattan in stone and glass, greys and buffs; Brooklyn and Queens mostly brick.
    if (l.borough === 'manhattan') col.setHSL(0.08 + r() * 0.06, 0.06 + r() * 0.18, 0.3 + r() * 0.35);
    else col.setHSL(0.02 + r() * 0.04, 0.3 + r() * 0.2, 0.22 + r() * 0.15);
    put(l.x, l.z, l.w, l.h, l.d, col);
  }
  for (const l of landmarks) for (const [w, d, h] of l.tiers) put(l.x, l.z, w / SCALE, h / SCALE, d / SCALE, col.setHSL(0.1, 0.08, 0.62));
  group.add(towers);
  // The Queensboro Bridge upriver: from 59th St over Roosevelt Island to Queens, a long steel cantilever on stone piers.
  const qa = lonLat([-73.9625, 40.7605]), qb = lonLat([-73.9400, 40.7515]);
  const qlen = Math.hypot(qb.x - qa.x, qb.z - qa.z), qyaw = -Math.atan2(qb.z - qa.z, qb.x - qa.x);
  const queensboro = new THREE.Group();
  queensboro.position.set((qa.x + qb.x) / 2, 0, (qa.z + qb.z) / 2);
  queensboro.rotation.y = qyaw;
  const stoneB = own(new THREE.MeshStandardMaterial({ color: '#8a7a68', roughness: 0.9 }));
  box(steel, 0, WATER + 10, 0, qlen, 3, 6, queensboro); // the deck, 40 m over the water
  for (const f of [-0.42, -0.14, 0.14, 0.42]) {
    box(stoneB, f * qlen, (WATER + WATER + 10) / 2, 0, 6, 10, 8, queensboro); // the piers
    box(steel, f * qlen, WATER + 10 + 12, 0, 3, 24, 7, queensboro); // the cantilever towers
  }
  for (let i = 0; i < 3; i++) {
    const a0 = [-0.42, -0.14, 0.14][i] * qlen, a1 = [-0.14, 0.14, 0.42][i] * qlen;
    for (const k of [0.25, 0.75]) box(steel, a0 + (a1 - a0) * k, WATER + 10 + 6, 0, (a1 - a0) / 2, 1.2, 6, queensboro); // the trusses
  }
  group.add(queensboro);
  // The sky: a gradient on a far plane that follows the camera along x.
  const skyTex = own(canvasTex(4, 256, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, '#1f2a48'); grd.addColorStop(0.55, '#b0607a'); grd.addColorStop(0.82, '#ffb36b'); grd.addColorStop(1, '#ffd9a0');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }));
  const sky = new THREE.Mesh(own(new THREE.PlaneGeometry(9000, 2400)), own(new THREE.MeshBasicMaterial({ map: skyTex, fog: false, toneMapped: false })));
  sky.position.set(0, 1000 + GROUND, -3400);
  group.add(sky);
  const sun = new THREE.DirectionalLight('#ffc27a', 0);
  scene.add(sun, sun.target);

  return {
    update(camX, camZ, time) {
      // k: how far the camera is out on the bridge, easing over 30 tiles from each anchorage.
      const k = Math.max(0, Math.min(1, Math.min(camX - (B.x0 - 10), B.x1 + 10 - camX) / 30));
      group.visible = camX > B.x0 - 60 && camX < B.x1 + 60; // underground, none of it
      scene.background.lerpColors(DARK, SKY, k);
      scene.fog.color.lerpColors(DARK, HAZE, k);
      scene.fog.near = 16 + (250 - 16) * k;
      scene.fog.far = 34 + (3000 - 34) * k;
      sun.intensity = 2.6 * k;
      sun.position.set(camX - 220, 70, 420);
      sun.target.position.set(camX, LEVEL.track, 9.5);
      sky.position.x = camX;
      nearSteel.opacity = camZ > 19.2 ? 0.25 : 1; // the south truss fades when it's between the camera and you
      nearSteel.depthWrite = nearSteel.opacity > 0.95;
      if (!reducedMotion) {
        waves.value = time;
        water.map.offset.y = (time * 0.004) % 1; // the current, downstream
        water.emissiveMap.offset.set((time * 0.002) % 1, (time * 0.006) % 1);
      }
      return k;
    },
    dispose() {
      group.removeFromParent(); sun.removeFromParent(); sun.target.removeFromParent();
      for (const o of owned) o.dispose?.();
    },
  };
}
