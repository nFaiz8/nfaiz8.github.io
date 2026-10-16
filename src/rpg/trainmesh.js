// The trains (subway ride spec §3): five New York cars, stainless and ribbed, three double doors a side, a cab at each
// end with a route bullet, a destination sign and lamps, warm inside with benches, poles and a strip map over each
// door. (No ad cards: Faiz tried them and preferred the walls bare.) A small pool of models is placed on the trains
// nearest the camera each frame.
//
// A model is built in its train's frame (x from its west end, z from the track's middle; car.js) and placed at the
// train's west end, so it's the same whichever way the train runs; only the lamps and signs know its direction.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { TRAIN, LENGTH } from './schedule.js';
import { CAR, PITCH, POLES, trainOrigin } from './car.js';
import { trussShade, sunAt, STOPS } from './line.js';
import { LEVEL } from './map.js';

const F = LEVEL.platform; // the car's floor, level with the platforms
const H = { bottom: F - 1.05, sill: F + 0.8, lintel: F + 1.7, ceil: F + 2.05, top: F + 2.45, bench: F + 0.32 };
export const POOL = 4; // models: enough for a local standing, one passing, and two in view from a train
const REACH = 120; // trains further from the camera than this aren't drawn
const WIN = 1.0, PIER = 0.22;

// The car's windows along it (u from its west end), between the doors: as many WIN-wide as fit with piers between.
export const WINDOWS = (() => {
  const [d0, d1, d2] = CAR.doors, g = CAR.door + 0.15, out = [];
  for (const [a, b] of [[0.45, d0 - g], [d0 + g, d1 - g], [d1 + g, d2 - g], [d2 + g, TRAIN.car - 0.45]]) {
    const n = Math.max(1, Math.floor((b - a + PIER) / (WIN + PIER))), w = (b - a - PIER * (n - 1)) / n;
    for (let i = 0; i < n; i++) out.push([a + i * (w + PIER), a + i * (w + PIER) + w]);
  }
  return out;
})();
const DOOR_GAPS = CAR.doors.map((d) => [d - CAR.door, d + CAR.door]);

// A box from (x0, y0, z0) to (x1, y1, z1), as geometry to merge.
const slab = (x0, x1, y0, y1, z0, z1) => new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
// The pieces of [a, b] not covered by the gaps.
function between(a, b, gaps) {
  const out = [];
  let x = a;
  for (const [g0, g1] of [...gaps].sort((p, q) => p[0] - q[0])) { if (g0 > x) out.push([x, Math.min(g0, b)]); x = Math.max(x, g1); }
  if (x < b) out.push([x, b]);
  return out.filter(([p, q]) => q - p > 1e-3);
}

// One side's outer wall (s = −1 north, +1 south): below the floor whole, from the floor to the sill and up the window
// band broken by the doors (and the windows), and whole above the lintel.
function sideGeo(s) {
  const z0 = s * (CAR.half - 0.08), z1 = s * CAR.half, [za, zb] = [Math.min(z0, z1), Math.max(z0, z1)], parts = [];
  parts.push(slab(0, TRAIN.car, H.bottom, F, za, zb));
  for (const [a, b] of between(0, TRAIN.car, DOOR_GAPS)) parts.push(slab(a, b, F, H.sill, za, zb));
  for (const [a, b] of between(0, TRAIN.car, [...DOOR_GAPS, ...WINDOWS])) parts.push(slab(a, b, H.sill, H.lintel, za, zb));
  parts.push(slab(0, TRAIN.car, H.lintel, H.top, za, zb));
  return mergeGeometries(parts);
}
// The end walls with their end doors, and the gangway's bellows behind the car (not behind the last).
function endsGeo(last) {
  const p = [], t = CAR.end, hz = CAR.half - 0.08;
  for (const [u0, u1] of [[0, t], [TRAIN.car - t, TRAIN.car]]) {
    p.push(slab(u0, u1, H.bottom, H.top, -hz, -CAR.pass), slab(u0, u1, H.bottom, H.top, CAR.pass, hz));
    p.push(slab(u0, u1, H.lintel, H.top, -CAR.pass, CAR.pass), slab(u0, u1, H.bottom, F, -CAR.pass, CAR.pass));
  }
  if (!last) for (const s of [-1, 1]) p.push(slab(TRAIN.car, PITCH, F, H.lintel + 0.1, s * 0.62 - 0.04, s * 0.62 + 0.04));
  if (!last) p.push(slab(TRAIN.car, PITCH, H.lintel + 0.1, H.lintel + 0.18, -0.66, 0.66));
  return mergeGeometries(p);
}
function benchGeo() {
  const p = [], [d0, d1, d2] = CAR.doors, g = CAR.door + 0.2;
  for (const s of [-1, 1]) for (const [a, b] of [[0.5, d0 - g], [d0 + g, d1 - g], [d1 + g, d2 - g], [d2 + g, TRAIN.car - 0.5]]) {
    const z0 = s * CAR.bench, z1 = s * CAR.wall;
    p.push(slab(a, b, F, H.bench, Math.min(z0, z1), Math.max(z0, z1)));
    p.push(slab(a, b, H.bench, H.bench + 0.38, s > 0 ? CAR.wall - 0.06 : -CAR.wall, s > 0 ? CAR.wall : -CAR.wall + 0.06)); // the backrest
  }
  return mergeGeometries(p);
}
function chromeGeo() {
  const p = [];
  for (const d of CAR.doors) p.push(new THREE.CylinderGeometry(CAR.pole, CAR.pole, H.ceil - F, 8).translate(d, (F + H.ceil) / 2, 0));
  for (const s of [-1, 1]) p.push(slab(0.3, TRAIN.car - 0.3, H.ceil - 0.18, H.ceil - 0.14, s * 0.72 - 0.02, s * 0.72 + 0.02));
  return mergeGeometries(p);
}

// A patch of light: bright in the middle, fading to nothing at its edges.
function softTexture() {
  return canvasTexture(64, 64, (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.6, 'rgba(255,255,255,0.45)'); r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  });
}
function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
// Stainless steel with its ribs, as glyphs: │ in a lighter grey on the steel, one rib every 1/8 of a unit.
const fluted = () => {
  const t = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#9ea4ae'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#d6dbe3'; g.font = '16px monospace'; g.textAlign = 'center';
    for (let x = 4; x < w; x += 8) for (let y = 14; y < h + 14; y += 16) g.fillText('│', x, y);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(TRAIN.car / 2, 2);
  return t;
};
const floorTex = () => {
  const t = canvasTexture(64, 64, (g, w, h) => {
    g.fillStyle = '#3c3a38'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#6c6862'; g.font = '14px monospace';
    for (let i = 0; i < 18; i++) g.fillText('·', (i * 37) % w, ((i * 23) % h) + 8);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(TRAIN.car, 3);
  return t;
};
// The cab's face: two windows, the route bullet, and the destination sign (redrawn when the text changes).
function cabTexture(dest, lit) {
  return canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#a9afb8'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#16181c'; g.fillRect(18, 40, 90, 90); g.fillRect(148, 40, 90, 90);
    g.fillStyle = lit ? '#ff9a1f' : '#3a2a14'; g.beginPath(); g.arc(128, 22, 15, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#111'; g.font = 'bold 20px monospace'; g.textAlign = 'center'; g.fillText('F', 128, 29);
    g.fillStyle = '#0a0a0a'; g.fillRect(28, 140, 200, 30);
    g.fillStyle = lit ? '#ffb340' : '#2a1d0a'; g.font = 'bold 22px monospace'; g.fillText(dest, 128, 163);
    g.fillStyle = '#8b9099'; for (let x = 8; x < w; x += 10) g.fillRect(x, 190, 2, 60);
  });
}
// The strip map over a door: the stations as dots on a line, the next one lit.
function stripTexture(next) {
  return canvasTexture(256, 32, (g, w, h) => {
    g.fillStyle = '#f2efe8'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#ff9a1f'; g.lineWidth = 4; g.beginPath(); g.moveTo(30, 16); g.lineTo(w - 30, 16); g.stroke();
    STOPS.forEach((s, i) => {
      const x = i === 0 ? 30 : w - 30;
      g.fillStyle = i === next ? '#e2483d' : '#2b2a28'; g.beginPath(); g.arc(x, 16, i === next ? 8 : 6, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#2b2a28'; g.font = '10px monospace'; g.textAlign = i === 0 ? 'left' : 'right'; g.fillText(s.name, i === 0 ? 44 : w - 44, 12);
    });
  });
}
// The LED text inside, drawn once and scrolled a character at a time (as the station's ticker is).
function ledTexture(text) {
  const t = canvasTexture(Math.max(64, text.length * 12), 24, (g, w, h) => {
    g.fillStyle = '#0a0705'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ff6a2a'; g.font = 'bold 18px monospace'; g.fillText(text, 0, 18);
  });
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(Math.min(1, 24 / Math.max(1, text.length)), 1);
  return t;
}
export function createTrains(scene, { reducedMotion = false } = {}) {
  const owned = [];
  const own = (x) => { owned.push(x); return x; };
  const geo = {
    north: own(sideGeo(-1)), south: own(sideGeo(1)), ends: own(endsGeo(false)), lastEnds: own(endsGeo(true)),
    roof: own(slab(0, TRAIN.car, H.top, H.top + 0.1, -CAR.half, CAR.half)),
    floor: own(slab(0.1, TRAIN.car - 0.1, F - 0.06, F, -CAR.wall, CAR.wall)),
    bench: own(benchGeo()), chrome: own(chromeGeo()),
    strip: own(new THREE.BoxGeometry(TRAIN.car - 0.6, 0.03, 0.12)),
    bogie: own(slab(1.2, 3.6, H.bottom - 0.45, H.bottom, -1.0, 1.0)),
    cab: own(new THREE.PlaneGeometry(2.9, 3.3)),
    stripMap: own(new THREE.PlaneGeometry(1.2, 0.15)),
    leaf: own(new THREE.BoxGeometry(CAR.door, H.lintel - F, 0.05)),
    lamp: own(new THREE.SphereGeometry(0.1, 10, 8)),
    patch: own(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2)),
  };
  const steelTex = own(fluted());
  const mat = {
    steel: own(new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.55, roughness: 0.38 })),
    floor: own(new THREE.MeshStandardMaterial({ map: own(floorTex()), roughness: 0.9 })),
    orange: own(new THREE.MeshStandardMaterial({ color: '#e8772e', emissive: '#3a1606', roughness: 0.6 })),
    chrome: own(new THREE.MeshStandardMaterial({ color: '#d8dde6', metalness: 0.9, roughness: 0.2 })),
    bogie: own(new THREE.MeshStandardMaterial({ color: '#1b1c1f', roughness: 0.8 })),
    leaf: own(new THREE.MeshStandardMaterial({ map: steelTex, metalness: 0.5, roughness: 0.4, color: '#c8ccd4' })),
    // Sunlight on the floor: soft-edged (a hard rectangle reads as a white block), and faint.
    shaft: own(new THREE.MeshBasicMaterial({ color: '#ffcf8a', map: own(softTexture()), transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
  };

  function build() {
    const group = new THREE.Group(), cars = [];
    const glow = own(new THREE.MeshBasicMaterial({ color: '#fff4dc', toneMapped: false }));
    const stripMats = [own(new THREE.MeshBasicMaterial({ map: own(stripTexture(0)), toneMapped: false })), own(new THREE.MeshBasicMaterial({ map: own(stripTexture(1)), toneMapped: false }))];
    for (let c = 0; c < TRAIN.cars; c++) {
      const g = new THREE.Group();
      g.position.x = c * PITCH;
      const south = own(mat.steel.clone()), roofMat = own(mat.steel.clone());
      south.transparent = roofMat.transparent = true;
      const parts = {
        north: new THREE.Mesh(geo.north, mat.steel), south: new THREE.Mesh(geo.south, south),
        ends: new THREE.Mesh(c === TRAIN.cars - 1 ? geo.lastEnds : geo.ends, mat.steel), roof: new THREE.Mesh(geo.roof, roofMat),
        floor: new THREE.Mesh(geo.floor, mat.floor), bench: new THREE.Mesh(geo.bench, mat.orange), chrome: new THREE.Mesh(geo.chrome, mat.chrome),
      };
      for (const m of Object.values(parts)) g.add(m);
      for (const s of [-0.62, 0.62]) { const l = new THREE.Mesh(geo.strip, glow); l.position.set(TRAIN.car / 2, H.ceil, s); g.add(l); }
      for (const u of [2.4, TRAIN.car - 2.4]) { const b = new THREE.Mesh(geo.bogie, mat.bogie); b.position.x = u - 2.4; g.add(b); }
      const strips = [];
      for (const d of CAR.doors) for (const s of [-1, 1]) {
        const m = new THREE.Mesh(geo.stripMap, stripMats[0]);
        m.position.set(d, H.lintel + 0.05, s * (CAR.wall - 0.01));
        m.rotation.y = s > 0 ? Math.PI : 0;
        g.add(m); strips.push(m);
      }
      group.add(g);
      cars.push({ g, parts, south, roofMat, strips, fade: 1 });
    }
    // Door leaves: two a doorway, both sides, every car.
    const leaves = new THREE.InstancedMesh(geo.leaf, mat.leaf, TRAIN.cars * CAR.doors.length * 4);
    group.add(leaves);
    // The cabs' faces, west and east, and their lamps (white at the front, red at the back).
    const cabs = [0, 1].map((e) => {
      const m = new THREE.Mesh(geo.cab, own(new THREE.MeshStandardMaterial({ map: own(cabTexture('', false)), metalness: 0.4, roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.05 })));
      m.position.set(e ? LENGTH + 0.01 : -0.01, (H.bottom + H.top) / 2, 0);
      m.rotation.y = e ? Math.PI / 2 : -Math.PI / 2;
      group.add(m);
      const lamps = [-0.9, 0.9].map((z) => { const l = new THREE.Mesh(geo.lamp, own(new THREE.MeshBasicMaterial({ color: '#fff3d0', toneMapped: false }))); l.position.set(e ? LENGTH + 0.03 : -0.03, H.bottom + 0.5, z); group.add(l); return l; });
      return { m, lamps, key: '' };
    });
    // Light shafts (bridge sun) and lamp bands (tunnel): a floor patch per south window, scaled by how much light it lets in.
    const patches = new THREE.InstancedMesh(geo.patch, mat.shaft, TRAIN.cars * WINDOWS.length);
    patches.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    group.add(patches);
    const light = new THREE.PointLight('#ffe2b0', 0, 9, 1.6); // inside, at the car nearest the camera
    const headlight = new THREE.PointLight('#fff1cc', 0, 14, 1.4);
    group.add(light, headlight);
    // The LED over each car's end doors, inside, facing into the car.
    const ledMat = own(new THREE.MeshBasicMaterial({ toneMapped: false }));
    const ledGeo = own(new THREE.PlaneGeometry(1.6, 0.16));
    for (let c = 0; c < TRAIN.cars; c++) for (const u of [CAR.end + 0.01, TRAIN.car - CAR.end - 0.01]) {
      const l = new THREE.Mesh(ledGeo, ledMat);
      l.position.set(c * PITCH + u, H.lintel + 0.12, 0);
      l.rotation.y = u < 1 ? Math.PI / 2 : -Math.PI / 2;
      group.add(l);
    }
    scene.add(group);
    return { group, cars, leaves, cabs, patches, light, headlight, glow, stripMats, ledMat, ledKey: null, id: null };
  }

  const pool = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color();
  const FLAT = new THREE.Quaternion();
  const shown = [];

  function place(model, tr, ctx) {
    const o = trainOrigin(tr), mine = tr.id === ctx.mine;
    model.group.visible = true;
    model.group.position.set(o.x, 0, o.z);
    const local = tr.kind === 'local';
    model.glow.color.set(local ? '#fff4dc' : '#5a5650');
    // Cars outside an express's stretch aren't drawn (it doesn't run there).
    for (let c = 0; c < TRAIN.cars; c++) {
      const car = model.cars[c], x0 = o.x + c * PITCH, x1 = x0 + TRAIN.car;
      car.g.visible = !tr.clip || (x1 > tr.clip[0] && x0 < tr.clip[1]);
      // The roof and south wall fade when the car is between you and the camera, or you're in it (spec §3).
      const cx = (x0 + x1) / 2, near = o.z > ctx.me.z - 1.6 && o.z < ctx.me.z + 10 && Math.abs(cx - ctx.me.x) < TRAIN.car / 2 + 6;
      const inIt = mine && Math.abs(cx - ctx.me.x) < TRAIN.car / 2 + 0.4;
      const target = inIt ? 0 : near ? 0.18 : 1;
      car.fade += (target - car.fade) * (1 - Math.exp(-ctx.dt / 0.15));
      car.roofMat.opacity = car.fade; car.south.opacity = Math.max(car.fade, inIt ? 0.12 : 0);
      car.parts.roof.visible = car.fade > 0.02;
      car.roofMat.depthWrite = car.south.depthWrite = car.fade > 0.95;
    }
    // The strip maps light the next stop.
    const next = tr.kind === 'local' ? (tr.dir > 0 ? (tr.tau < 0 ? 0 : 1) : (tr.tau < 0 ? 1 : 0)) : 0;
    for (const car of model.cars) for (const s of car.strips) s.material = model.stripMats[next];
    // Doors: the platform side's leaves slide apart as tr.doors goes 0 → 1.
    let i = 0;
    for (let c = 0; c < TRAIN.cars; c++) for (const d of CAR.doors) for (const s of [-1, 1]) for (const side of [-1, 1]) {
      const open = tr.at != null && Math.sign(s) === (tr.track.i === 0 ? 1 : -1) ? tr.doors : 0;
      v.set(c * PITCH + d + side * (CAR.door / 2 + open * CAR.door * 0.95), (F + H.lintel) / 2, s * (CAR.half - 0.1));
      // The south side's leaves go with its wall when that fades, or they'd stand as dark slabs between you and the car.
      const hide = s > 0 && model.cars[c].fade < 0.5;
      m4.compose(v, q.identity(), hide ? sc.set(0, 0, 0) : sc.set(1, 1, 1));
      model.leaves.setMatrixAt(i++, m4);
    }
    model.leaves.instanceMatrix.needsUpdate = true;
    // The cabs: the front's lamps white, the back's red; the destination on both.
    const dest = local ? (tr.dir > 0 ? STOPS[1].name : STOPS[0].name) : '';
    model.cabs.forEach((cab, e) => {
      const front = (e === 1) === (tr.dir > 0);
      for (const l of cab.lamps) l.material.color.set(front ? '#fff3d0' : '#ff2a1a');
      const key = `${dest}|${local}`;
      if (cab.key !== key) { cab.key = key; cab.m.material.map.dispose(); cab.m.material.map = own(cabTexture(dest, local)); cab.m.material.needsUpdate = true; }
    });
    // The car rocks gently as it runs (spec §4); the camera follows the frame, not the rock, so the world stays still.
    model.group.rotation.x = reducedMotion ? 0 : 0.007 * Math.min(1, tr.speed / 20) * Math.sin(ctx.time * 1.7 + (tr.k ?? tr.m ?? 0));
    // The LED inside over the end doors: where it's going and the next stop, or LAST STOP.
    const led = !local ? '' : tr.last ? `   THIS IS THE LAST STOP ON THIS TRAIN · EVERYONE PLEASE LEAVE THE TRAIN ·` : `   THIS IS A ${dest} BOUND TRAIN · THE NEXT STOP IS ${STOPS[next].name} ·`;
    if (model.ledKey !== led) { model.ledKey = led; model.ledMat.map?.dispose(); model.ledMat.map = own(ledTexture(led)); model.ledMat.needsUpdate = true; }
    if (model.ledMat.map) model.ledMat.map.offset.x = reducedMotion ? 0 : Math.floor(ctx.time * 6) / 60;
    model.headlight.position.set(tr.dir > 0 ? LENGTH + 3 : -3, H.bottom + 0.6, 0);
    model.headlight.intensity = tr.speed > 0.5 ? 10 : 0;
    // Inside: a warm light at the car nearest the camera (locals only).
    const cNear = Math.min(TRAIN.cars - 1, Math.max(0, Math.floor((ctx.me.x - o.x) / PITCH)));
    model.light.position.set(cNear * PITCH + TRAIN.car / 2, H.ceil - 0.3, 0);
    model.light.intensity = local ? 6 : 0.6;
    // Shafts and lamp bands through the south windows.
    let p = 0;
    for (let c = 0; c < TRAIN.cars; c++) for (const [a, b] of WINDOWS) {
      const wx = o.x + c * PITCH + (a + b) / 2;
      const k = Math.min(1, (ctx.sun ?? 1) * sunAt(wx) * trussShade(wx)); // (no lamp bands in the tunnels: Faiz saw white blocks)
      v.set(c * PITCH + (a + b) / 2 + 0.35, F + 0.01, 0.25);
      m4.compose(v, FLAT, sc.set(k > 0.01 ? (b - a) * 1.1 : 0, 1, k > 0.01 ? 2.1 : 0));
      model.patches.setColorAt(p, col.setScalar(k));
      model.patches.setMatrixAt(p++, m4);
    }
    model.patches.instanceMatrix.needsUpdate = true;
    if (model.patches.instanceColor) model.patches.instanceColor.needsUpdate = true;
    shown.push({ id: tr.id, x: o.x, z: o.z, roof: model.cars.map((c) => +c.fade.toFixed(2)) });
  }

  return {
    // trains: everything on the line now; ctx: { me (world x, z), mine (your train's id), time, dt, sun }.
    update(trains, ctx) {
      shown.length = 0;
      const near = trains
        .map((tr) => ({ tr, d: Math.max(0, Math.min(Math.abs(tr.head - ctx.me.x), Math.abs(tr.tail - ctx.me.x), (tr.head - ctx.me.x) * (tr.tail - ctx.me.x) < 0 ? 0 : Infinity)) }))
        .filter((e) => e.d < REACH || e.tr.id === ctx.mine)
        .sort((a, b) => (a.tr.id === ctx.mine ? -1 : b.tr.id === ctx.mine ? 1 : a.d - b.d))
        .slice(0, POOL);
      // Keep each train on the model it had, so fades and signs don't jump between models.
      const used = new Set();
      for (const { tr } of near) {
        let m = pool.find((p) => p.id === tr.id && !used.has(p));
        if (!m) m = pool.find((p) => !used.has(p) && !near.some((e) => e.tr.id === p.id));
        if (!m && pool.length < POOL) { m = build(); pool.push(m); }
        if (!m) continue;
        if (m.id !== tr.id) { m.id = tr.id; for (const car of m.cars) car.fade = 1; }
        used.add(m);
        place(m, tr, ctx);
      }
      for (const m of pool) if (!used.has(m)) { m.group.visible = false; m.id = null; m.light.intensity = m.headlight.intensity = 0; }
    },
    shown: () => shown.slice(),
    dispose() {
      for (const m of pool) { m.leaves.dispose(); m.patches.dispose(); m.group.removeFromParent(); }
      for (const o of owned) o.dispose?.();
    },
  };
}
