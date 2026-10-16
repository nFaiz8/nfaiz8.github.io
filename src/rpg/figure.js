// You, drawn the arena's way (task 8b): each bone one bold `|` glyph stretched from joint to joint, an `O`
// head and the lantern `¤`, all flat glyphs turned to the camera, with the arena's dark outline. rig.js
// poses the skeleton; this only draws it.
import * as THREE from 'three';
import { FONT } from './sprites.js';
import { HEAD } from './rig.js';
import { CAM } from './camera.js';

const PX = 96; // the font's pixel size on the glyph canvases
const COLOR = '#ffce6e'; // the arena's player amber (e2e/shots/fight-gl-computer.png)
const LANTERN = '#ffce6e';
const INK = '#07080b'; // the outline
// Sizes matched to the arena shot by eye. The camera looks down 35°, so the body shows ~cos 35° of its height,
// but the head, square to the camera, shows all of its own: it's drawn that much smaller to keep the arena's
// head-to-body ratio. The arena's O is a little narrower than this font's, too.
const BAR_W = 0.044; // a bone's drawn width: the arena's line is ~1/32 of the figure's height on screen
const HEAD_SQUASH = { h: Math.cos(CAM.pitch), w: 0.88 * Math.cos(CAM.pitch) };
const CAP = 0.6; // each bone runs this many widths past its joints, so the joints close up
const EDGE = 0.014; // the outline's width round each bone
const LANTERN_H = 0.13; // the ¤'s ink height
const JOINTS = ['hip', 'shoulder', 'elbowL', 'elbowR', 'kneeL', 'kneeR']; // rounded off, so a bend has no notch
const BONES = [
  ['hip', 'neck'],
  ['shoulder', 'elbowL'], ['elbowL', 'handL'], ['shoulder', 'elbowR'], ['elbowR', 'handR'],
  ['hip', 'kneeL'], ['kneeL', 'footL'], ['hip', 'kneeR'], ['kneeR', 'footR'],
];

// A glyph on its own canvas, cropped to its ink plus pad px each side; with stroke, drawn outlined too
// (white, so a material's colour tints it).
function glyph(ch, { pad = 0, stroke = 0 } = {}) {
  const c = document.createElement('canvas').getContext('2d');
  c.font = `700 ${PX}px ${FONT}`;
  const m = c.measureText(ch);
  const l = m.actualBoundingBoxLeft, r = m.actualBoundingBoxRight, a = m.actualBoundingBoxAscent, d = m.actualBoundingBoxDescent;
  const inkW = l + r, inkH = a + d;
  c.canvas.width = Math.ceil(inkW + 2 * pad);
  c.canvas.height = Math.ceil(inkH + 2 * pad);
  c.font = `700 ${PX}px ${FONT}`;
  c.textBaseline = 'alphabetic';
  c.fillStyle = c.strokeStyle = '#fff';
  c.lineJoin = 'round';
  const x = pad + l, y = pad + a;
  if (stroke) { c.lineWidth = stroke; c.strokeText(ch, x, y); }
  c.fillText(ch, x, y);
  const tex = new THREE.CanvasTexture(c.canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, w: c.canvas.width, h: c.canvas.height, inkH };
}

// The post's ACES tone mapping (index.js, post.js) dulls everything it draws, toneMapped or not, so a glowing
// colour is given as the linear value that comes out of it as that colour: found by a few fixed-point steps
// through three's ACESFilmicToneMapping at exposure 1.
const ACES_IN = [[0.59719, 0.35458, 0.04823], [0.076, 0.90834, 0.01566], [0.0284, 0.13383, 0.83777]];
const ACES_OUT = [[1.60475, -0.53108, -0.07367], [-0.10208, 1.10813, -0.00605], [-0.00327, -0.07276, 1.07602]];
const mul = (m, c) => m.map((r) => r[0] * c[0] + r[1] * c[1] + r[2] * c[2]);
const aces = (c) => mul(ACES_OUT, mul(ACES_IN, c.map((x) => x / 0.6)).map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.432951) + 0.238081))).map((x) => Math.min(1, Math.max(0, x)));
function throughAces(hex) {
  const want = new THREE.Color(hex), w = [want.r, want.g, want.b], c = [...w]; // linear
  for (let i = 0; i < 400; i++) { const o = aces(c); for (let k = 0; k < 3; k++) c[k] = Math.max(0, c[k] + 0.5 * (w[k] - o[k])); }
  return new THREE.Color().setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
}

export function createFigure(scene, opts = {}) {
  // Whatever was made before a throw (a failed glyph, say) is freed, like index.js's own teardown.
  const made = [], meshes = [];
  const free = () => { for (const o of meshes) o.removeFromParent(); for (const x of made) x.dispose(); };
  try {
    return build(scene, opts, made, meshes, free);
  } catch (err) {
    free();
    throw err;
  }
}

// opts: glow (you: bright, past tone mapping), color (the bones and head), lantern (the ¤; commuters have none),
// phone (a small lit screen at the hand, for a commuter on the phone).
function build(scene, { glow = true, color = COLOR, lantern: hasLantern = true, phone = false }, made, meshes, free) {
  const own = (x) => (made.push(x), x);
  const tint = (hex) => (glow ? throughAces(hex) : new THREE.Color(hex));
  const mat = (map, color, alphaTest = 0.05) => own(new THREE.MeshBasicMaterial({ map, color: tint(color), transparent: true, alphaTest, depthWrite: false, side: THREE.DoubleSide, toneMapped: !glow }));
  const quad = own(new THREE.PlaneGeometry(1, 1));
  const mesh = (m, order) => {
    const o = new THREE.Mesh(quad, m);
    o.matrixAutoUpdate = false;
    o.frustumCulled = false;
    o.renderOrder = order; // every outline first, then every fill, so no outline cuts across a join
    scene.add(o);
    meshes.push(o);
    return o;
  };

  // Bones: one shared `|`, cropped to its ink so it spans the quad. The outline is the same glyph, dark and a
  // little bigger, under it.
  const bar = glyph('|');
  own(bar.tex);
  const barFill = mat(bar.tex, color), barEdge = mat(bar.tex, INK);
  const bones = BONES.map(([a, b]) => ({ a, b, edge: mesh(barEdge, 2), fill: mesh(barFill, 3) }));

  // A round joint where bones bend, a bone's width across: two bars meeting at an angle leave a notch at the
  // outer corner that this fills.
  const dc = document.createElement('canvas').getContext('2d');
  dc.canvas.width = dc.canvas.height = 64;
  dc.fillStyle = '#fff';
  dc.beginPath(); dc.arc(32, 32, 31, 0, 2 * Math.PI); dc.fill();
  const dotTex = own(new THREE.CanvasTexture(dc.canvas));
  const dotFill = mat(dotTex, color, 0.5), dotEdge = mat(dotTex, INK, 0.5); // hard-edged: a soft rim showed as a ring
  const dots = JOINTS.map((k) => ({ k, edge: mesh(dotEdge, 2), fill: mesh(dotFill, 3) }));
  const ROUND = { w: BAR_W, h: BAR_W }, ROUND_EDGE = { w: BAR_W + 2 * EDGE, h: BAR_W + 2 * EDGE };

  // The head and the lantern face the camera. The outlined canvas is the same size as the fill's, so the two
  // quads line up; each is sized so the glyph's ink is the height asked for.
  const sprite = (ch, inkH, color, squash = { w: 1, h: 1 }) => {
    const stroke = Math.round(PX * 0.12), pad = stroke;
    const fill = glyph(ch, { pad }), edge = glyph(ch, { pad, stroke });
    own(fill.tex); own(edge.tex);
    const k = inkH / fill.inkH;
    return { w: fill.w * k * squash.w, h: fill.h * k * squash.h, edge: mesh(mat(edge.tex, INK), 2), fill: mesh(mat(fill.tex, color), 3) };
  };
  const head = sprite('O', 2 * HEAD.r, color, HEAD_SQUASH);
  const lantern = hasLantern ? sprite('¤', LANTERN_H, LANTERN) : null;
  // The phone: a small pale-blue screen, past tone mapping so it reads as lit, square to the camera.
  let screen = null;
  if (phone) {
    const m = own(new THREE.MeshBasicMaterial({ color: new THREE.Color(0.75, 0.95, 1.3), toneMapped: false, depthWrite: false, transparent: true }));
    const ink = own(new THREE.MeshBasicMaterial({ color: INK, depthWrite: false, transparent: true }));
    screen = { w: 0.07, h: 0.1, rim: { w: 0.09, h: 0.12 }, edge: mesh(ink, 2), fill: mesh(m, 4) };
  }

  // Scratch, reused every frame.
  const pa = new THREE.Vector3(), pb = new THREE.Vector3(), mid = new THREE.Vector3(), dir = new THREE.Vector3();
  const side = new THREE.Vector3(), normal = new THREE.Vector3(), toCam = new THREE.Vector3(), camPos = new THREE.Vector3();
  const camRight = new THREE.Vector3(), camUp = new THREE.Vector3(), camBack = new THREE.Vector3();
  const tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();

  const place = (o, x, y, z) => { o.matrix.setPosition(x, y, z); o.matrixWorldNeedsUpdate = true; };
  // A flat glyph square to the camera at p (centred).
  const square = (o, size, p, at) => {
    o.matrix.makeBasis(tmpA.copy(camRight).multiplyScalar(size.w), tmpB.copy(camUp).multiplyScalar(size.h), camBack);
    place(o, at.x + p.x, at.y + p.y, at.z + p.z);
  };
  const face = (s, p, at) => { square(s.edge, s, p, at); square(s.fill, s, p, at); };
  // A bone from a to b: its long axis along the bone, turned about it to face the camera (axial billboard).
  const stretch = (o, len, width) => {
    o.matrix.makeBasis(tmpA.copy(side).multiplyScalar(width), tmpB.copy(dir).multiplyScalar(len), normal);
    place(o, mid.x, mid.y, mid.z);
  };

  return {
    // joints from poseFigure, placed at `at` (your feet point in the world).
    update(joints, camera, at) {
      camera.updateMatrixWorld();
      camPos.setFromMatrixPosition(camera.matrixWorld);
      camRight.setFromMatrixColumn(camera.matrixWorld, 0);
      camUp.setFromMatrixColumn(camera.matrixWorld, 1);
      camBack.setFromMatrixColumn(camera.matrixWorld, 2);
      for (const bone of bones) {
        pa.set(at.x + joints[bone.a].x, at.y + joints[bone.a].y, at.z + joints[bone.a].z);
        pb.set(at.x + joints[bone.b].x, at.y + joints[bone.b].y, at.z + joints[bone.b].z);
        mid.addVectors(pa, pb).multiplyScalar(0.5);
        dir.subVectors(pb, pa);
        const len = dir.length();
        if (len > 1e-9) dir.divideScalar(len); else dir.copy(camUp);
        side.crossVectors(dir, toCam.subVectors(camPos, mid));
        if (side.lengthSq() < 1e-12) side.copy(camRight); else side.normalize();
        normal.crossVectors(side, dir);
        const l = len + CAP * BAR_W * 2;
        stretch(bone.edge, l + 2 * EDGE, BAR_W + 2 * EDGE);
        stretch(bone.fill, l, BAR_W);
      }
      for (const d of dots) { square(d.edge, ROUND_EDGE, joints[d.k], at); square(d.fill, ROUND, joints[d.k], at); }
      face(head, joints.head, at);
      if (lantern) face(lantern, joints.lantern, at);
      if (screen) { square(screen.edge, screen.rim, joints.lantern, at); square(screen.fill, screen, joints.lantern, at); }
    },
    // Shown or not (a pooled figure with nobody to be).
    setVisible(on) { for (const o of meshes) o.visible = on; },
    dispose: free,
  };
}
