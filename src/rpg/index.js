// The station (station spec): built into its own canvas over the stage, running until you take the exit,
// then torn down completely. keys() is main.js's input state ({ x, y, run }); on a touch screen a held
// finger walks you toward it.
import * as THREE from 'three';
import stationText from './station.txt?raw';
import { parseStation } from './map.js';
import { createWalker, stepWalker, SPEED } from './move.js';
import { trainAt } from './train.js';
import { createCamera, followCamera, eyeFor, fovFor } from './camera.js';
import { buildScene } from './scene.js';
import { createFigure } from './figure.js';
import { poseFigure, turnToward, advancePhase } from './rig.js';
import { createPost } from './post.js';

const GAIT_EASE = 0.12; // seconds for the gait to follow your speed

// Where your feet go: the floor, or on a stair the top of the tread you're over. The ramp you walk on runs
// through the treads' front edges (scene.js), so it's above a tread everywhere else and you'd float.
const TREAD = 0.5;
function footY(map, w) {
  const s = map.at(Math.floor(w.x), Math.floor(w.z))?.stair;
  if (!s || s.from == null || s.to == null) return w.y;
  const along = s.dx ? (w.x - s.start) * s.dx : (w.z - s.start) * s.dz;
  const front = Math.min(s.len, (Math.floor(along / TREAD + 1e-6) + 1) * TREAD);
  return s.from + ((s.to - s.from) * front) / s.len;
}

export function startStation(stage, { onExit, keys, reducedMotion = false, phone = false }) {
  // Everything that needs tearing down, so a throw anywhere in setup (no WebGL, a failed build) leaves nothing
  // behind: stop() and a failed start share teardown().
  let canvas, renderer, world, figure, blobGeo, blobMat, post, raf = 0, resize = null, hook = null;
  const teardown = () => {
    cancelAnimationFrame(raf);
    if (resize) removeEventListener('resize', resize);
    world?.dispose();
    figure?.dispose();
    blobGeo?.dispose();
    blobMat?.dispose();
    post?.dispose();
    renderer?.dispose();
    renderer?.forceContextLoss();
    canvas?.remove();
    if (hook && window.__station === hook) delete window.__station;
  };
  try {
    const map = parseStation(stationText);
    canvas = document.createElement('canvas');
    canvas.className = 'station';
    canvas.style.touchAction = 'none';
    stage.append(canvas);
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    world = buildScene(scene, map, { reducedMotion });
    const walker = createWalker(map);

    // You: the arena's stick figure, posed each frame (rig.js) and drawn as glyphs (figure.js).
    figure = createFigure(scene, { glow: true });
    const joints = {}, pose = { yaw: 0, phase: 0, gait: 0, t: 0, reducedMotion };
    const feet = { x: 0, y: 0, z: 0 }; // reused each frame
    let targetYaw = 0, walked = walker.walked;
    const lantern = new THREE.PointLight('#ffb35c', 9, 6.5, 1.8);
    blobGeo = new THREE.CircleGeometry(0.32, 24).rotateX(-Math.PI / 2);
    blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.45, depthWrite: false });
    const blob = new THREE.Mesh(blobGeo, blobMat);
    scene.add(lantern, blob);

    post = createPost(renderer, scene, camera);
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
    resize = () => {
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

    let last = performance.now(), t0 = last, leaving = false, frames = 0;
    const time = () => (performance.now() - t0) / 1000;
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; } // paused while hidden (spec §5)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = (now - t0) / 1000;
      stepWalker(walker, dt, finger ? fingerInput() : keys(), map);
      if (!leaving && map.at(Math.floor(walker.x), Math.floor(walker.z))?.ch === 'E') { leaving = true; onExit(); }

      // Face where you walk (keeping the last facing when you stop); the stride follows the ground covered,
      // and the gait is a smoothed speed, so starting and stopping blend.
      const speed = Math.hypot(walker.vx, walker.vz);
      if (speed > 0.3) targetYaw = Math.atan2(walker.vx, walker.vz);
      pose.yaw = turnToward(pose.yaw, targetYaw, dt);
      pose.gait += (speed / SPEED - pose.gait) * (1 - Math.exp(-dt / GAIT_EASE));
      pose.phase = advancePhase(pose.phase, walker.walked - walked, pose.gait);
      walked = walker.walked;
      pose.t = t;
      poseFigure(pose, joints);
      feet.x = walker.x; feet.y = footY(map, walker); feet.z = walker.z;
      blob.position.set(feet.x, feet.y + 0.02, feet.z);
      lantern.position.set(feet.x + joints.lantern.x, feet.y + joints.lantern.y, feet.z + joints.lantern.z);
      lantern.intensity = 9 * (reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 13) * Math.sin(t * 5.1));

      const train = trainAt(t, map);
      world.update(t, dt, walker, train);

      followCamera(cam, walker, dt, map, camera.aspect);
      const eye = eyeFor(cam), shake = world.shake ? world.shake(t, walker, train) : { x: 0, y: 0 };
      camera.position.set(eye.x + shake.x, eye.y + shake.y, eye.z);
      camera.lookAt(cam.x + shake.x, cam.y + shake.y, cam.z);
      figure.update(joints, camera, feet);
      v.set(walker.x, walker.y + 0.8, walker.z).project(camera);
      post.setFocus((v.y + 1) / 2);
      post.render();
      frames++;
    }
    raf = requestAnimationFrame(frame);

    hook = {
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
        canvas.removeEventListener('pointerdown', onDown);
        canvas.removeEventListener('pointermove', onMove);
        canvas.removeEventListener('pointerup', onUp);
        canvas.removeEventListener('pointercancel', onUp);
        teardown();
      },
    };
  } catch (err) {
    teardown();
    throw err;
  }
}
