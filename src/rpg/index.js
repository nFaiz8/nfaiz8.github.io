// The station (station spec): built into its own canvas over the stage, running until you take the exit,
// then torn down completely. keys() is main.js's input state ({ x, y, run }); on a touch screen a held
// finger walks you toward it.
import * as THREE from 'three';
import stationText from './station.txt?raw';
import { parseStation } from './map.js';
import { createWalker, stepWalker } from './move.js';
import { trainAt } from './train.js';
import { createCamera, followCamera, eyeFor, fovFor } from './camera.js';
import { buildScene } from './scene.js';
import { makeSprite, PLAYER, PLAYER_COLORS } from './sprites.js';
import { createPost } from './post.js';

export function startStation(stage, { onExit, keys, reducedMotion = false, phone = false }) {
  const map = parseStation(stationText);
  const canvas = document.createElement('canvas');
  canvas.className = 'station';
  canvas.style.touchAction = 'none';
  stage.append(canvas);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  } catch (err) {
    canvas.remove();
    throw err;
  }
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
  const world = buildScene(scene, map, { reducedMotion });
  const walker = createWalker(map);

  const me = makeSprite(PLAYER[0], PLAYER_COLORS, 1.6, { glow: true });
  const lantern = new THREE.PointLight('#ffb35c', 9, 6.5, 1.8);
  const blobGeo = new THREE.CircleGeometry(0.32, 24).rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false });
  const blob = new THREE.Mesh(blobGeo, blobMat);
  scene.add(me.mesh, lantern, blob);
  let shownFrame = 0;

  const post = createPost(renderer, scene, camera);
  const cam = createCamera(walker);

  // Touch: hold a finger down to walk toward it (spec §4).
  let finger = null;
  const onDown = (e) => { finger = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId); };
  const onMove = (e) => { if (finger) { finger.x = e.clientX; finger.y = e.clientY; } };
  const onUp = () => { finger = null; };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  const v = new THREE.Vector3();
  const fingerInput = () => {
    v.set(walker.x, walker.y + 0.8, walker.z).project(camera);
    const dx = finger.x - ((v.x + 1) / 2) * W, dy = finger.y - ((1 - v.y) / 2) * H, d = Math.hypot(dx, dy);
    return d < 14 ? { x: 0, y: 0 } : { x: dx / d, y: dy / d, run: false };
  };

  let W = 0, H = 0;
  const resize = () => {
    W = stage.clientWidth || innerWidth;
    H = stage.clientHeight || innerHeight;
    const dpr = Math.min(phone ? 1.5 : 2, devicePixelRatio || 1);
    renderer.setPixelRatio(dpr);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.fov = fovFor(camera.aspect);
    camera.updateProjectionMatrix();
    post.setSize(W, H, dpr);
  };
  resize();
  addEventListener('resize', resize);

  let raf = 0, last = performance.now(), t0 = last, leaving = false, frames = 0;
  const time = () => (performance.now() - t0) / 1000;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (document.hidden) { last = now; return; } // paused while hidden (spec §5)
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    const t = (now - t0) / 1000;
    stepWalker(walker, dt, finger ? fingerInput() : keys(), map);
    if (!leaving && map.at(Math.floor(walker.x), Math.floor(walker.z))?.ch === 'E') { leaving = true; onExit(); }

    const moving = Math.hypot(walker.vx, walker.vz) > 0.3;
    const f = moving ? Math.floor(walker.walked / 0.45) % 2 : 0;
    if (f !== shownFrame) { me.draw(PLAYER[f]); shownFrame = f; }
    me.mesh.position.set(walker.x, walker.y, walker.z);
    me.mesh.scale.x = walker.facing;
    blob.position.set(walker.x, walker.y + 0.02, walker.z);
    lantern.position.set(walker.x + 0.35 * walker.facing, walker.y + 1.1, walker.z + 0.15);
    lantern.intensity = 9 * (reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 13) * Math.sin(t * 5.1));

    const train = trainAt(t, map);
    world.update(t, dt, walker, train);

    followCamera(cam, walker, dt, map, camera.aspect);
    const eye = eyeFor(cam), shake = world.shake ? world.shake(t, walker, train) : { x: 0, y: 0 };
    camera.position.set(eye.x + shake.x, eye.y + shake.y, eye.z);
    camera.lookAt(cam.x + shake.x, cam.y + shake.y, cam.z);
    v.set(walker.x, walker.y + 0.8, walker.z).project(camera);
    post.setFocus((v.y + 1) / 2);
    post.render();
    frames++;
  }
  raf = requestAnimationFrame(frame);

  const hook = {
    map, walker,
    frames: () => frames,
    time,
    train: () => trainAt(time(), map),
    setTime(s) { t0 = performance.now() - s * 1000; },
    teleport(x, z) { walker.x = x; walker.z = z; walker.vx = walker.vz = 0; walker.y = map.levelAt(x, z) ?? walker.y; },
  };
  window.__station = hook;

  return {
    stop() {
      cancelAnimationFrame(raf);
      removeEventListener('resize', resize);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      world.dispose();
      me.dispose();
      blobGeo.dispose();
      blobMat.dispose();
      post.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
      if (window.__station === hook) delete window.__station;
    },
  };
}
