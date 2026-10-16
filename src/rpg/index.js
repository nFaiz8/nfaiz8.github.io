// The station (station spec): built into its own canvas over the stage, running until you take the exit,
// then torn down completely. keys() is main.js's input state ({ x, y, run }); on a touch screen a held
// finger walks you toward it.
import * as THREE from 'three';
import stationText from './station.txt?raw';
import { parseStation } from './map.js';
import { createWalker, stepWalker, SPEED } from './move.js';
import { sharedTime } from './train.js';
import { trainsAt, passFor } from './schedule.js';
import { createCamera, followCamera, eyeFor, fovFor, CAM } from './camera.js';
import { buildScene } from './scene.js';
import { createFigure } from './figure.js';
import { poseFigure, turnToward, advancePhase, stepGait, GAIT_EASE } from './rig.js';
import { createPost } from './post.js';
import { createGates, gatedMap, trackGates, bumped, blocked, easeArms, turnRotors, swingGates, rotorTurns, refused, ringState, alarmOn } from './gates.js';
import { createTicketMachine } from './ticket.js';
import { STATION_LIFE, COMMUTER, createCommuter, stepCommuter, pushOut } from './life.js';
import { createStationAudio } from './audio.js';
import { createOthers, createTalkBar } from './others.js';
import { createTrains } from './trainmesh.js';
import canalText from './canalst.txt?raw';
import { STOPS, pieceAt } from './line.js';
import { local, localsAt } from './schedule.js';
import { createRider, stepRider, frameOrigin, sit, stand, FADE } from './rider.js';
import { stationWithTrains, trainMap, offPoles, lurch, seatNear, trainOrigin, inTrain } from './car.js';
import { LEVEL } from './map.js';

// A phone held upright: 8 tiles across makes the view very tall, and its top looks over the far wall into the
// dark. The camera renders a view PORTRAIT_CROP times as tall and shows only its bottom part, so the top of
// the screen shows the far wall instead.
const PORTRAIT_CROP = 1.25;
const STILL = { x: 0, y: 0, run: false }; // the walker's input while the ticket machine is open

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

// mp (station spec, Multiplayer; null when off the net): { list(now) (peers3d's), tick({ x, z, y, a }) (where I
// am, every frame), now() (the server's clock, ms since 1970), chat() (opens the chat line), emote(kind) }. The
// train runs on the shared clock (sharedTime of now(), or of this machine's clock), unless setTime pins it.
export function startStation(stage, { onExit, keys, reducedMotion = false, phone = false, mp = null, ads = [] }) {
  // Everything that needs tearing down, so a throw anywhere in setup (no WebGL, a failed build) leaves nothing
  // behind: stop() and a failed start share teardown().
  let canvas, renderer, world, figure, blobGeo, blobMat, post, ticket, audio, raf = 0, resize = null, hook = null, others = null, talk = null, trainView = null, hint = null, fader = null, onKey = null;
  const stations = [null, null], groups = [null, null]; // the line's two stations (MUSEUM's is built at once)
  const people = []; // the commuters' figures
  const teardown = () => {
    cancelAnimationFrame(raf);
    if (resize) removeEventListener('resize', resize);
    ticket?.destroy();
    audio?.stop();
    others?.dispose();
    talk?.destroy();
    world?.dispose();
    stations[1]?.dispose();
    groups[1]?.removeFromParent();
    if (onKey) removeEventListener('keydown', onKey);
    hint?.remove();
    fader?.remove();
    trainView?.dispose();
    figure?.dispose();
    for (const p of people) p.figure.dispose();
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
    // The dark below ground, and its sky light (bridge.js warms them out on the bridge).
    scene.background = new THREE.Color('#05060a');
    scene.fog = new THREE.Fog('#05060a', 16, 34);
    scene.add(new THREE.HemisphereLight('#8090b8', '#1a1612', 0.6));
    const museum = new THREE.Group();
    scene.add(museum);
    const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 80);
    world = buildScene(museum, map, { reducedMotion });
    trainView = createTrains(scene, { reducedMotion, ads });
    const walker = createWalker(map);
    // The line's two stations (subway ride spec §5): MUSEUM built now, CANAL ST the first time the camera comes near it.
    // A station is hidden while the camera is away from it.
    const maps = [map, parseStation(canalText)];
    stations[0] = world; groups[0] = museum;
    const stationNear = (i, x) => x > STOPS[i].x - 140 && x < STOPS[i].x + STOPS[i].cols + 140;
    const rider = createRider(0);
    // The turnstiles: shut from the hall without a ticket, the emergency gate shut from the hall always (gates.js);
    // the walker collides with the map as gated.
    const gates = createGates(map), gated = gatedMap(map, gates, walker);
    // armed: the machine may open on the next bump (not again until you stop pushing); the emergency gate's red
    // light likewise flashes once per push.
    let armed = true, exitArmed = true, lastPass = null;
    // The map you walk on: your station's (MUSEUM's with its gates), with the locals standing there joined to it
    // (car.js), or your train's floor plan, its doors shut while it moves.
    const TRAIN_MAP = trainMap(0), FREE = { cols: Infinity, rows: Infinity };
    const frameMap = (tt) => {
      const f = rider.frame;
      if (f.kind === 'train') return TRAIN_MAP;
      const standing = localsAt(tt).filter((l) => l.at === f.stop);
      return stationWithTrains(f.stop === 0 ? gated : maps[f.stop], STOPS[f.stop].x, standing);
    };
    // Sound (spec §8): silent until a key press or tap here; closed with the station.
    audio = createStationAudio({ map, sources: { ...world.sources, tubes: map.tubes }, reducedMotion });
    ticket = createTicketMachine(gates, {
      onClose: () => { armed = false; walker.vx = walker.vz = 0; },
      onBought: () => { gates.note = null; }, // the ring goes from red to green
      onSound: (name) => audio.ticket(name),
    });

    // Commuters: the same stick figure, muted, without a lantern; one on the phone (its screen lights its face).
    const phoneLight = new THREE.PointLight('#9fd0ff', 0, 1.4, 2);
    scene.add(phoneLight);
    STATION_LIFE.commuters.forEach((spec, i) => {
      const c = createCommuter(spec, i);
      people.push({ c, figure: createFigure(scene, { glow: false, color: spec.color, lantern: false, phone: !!spec.phone }), joints: {}, at: { x: 0, y: 0, z: 0 },
        pose: { yaw: c.yaw, phase: 0, gait: 0, t: 0, reducedMotion, shift: 0, phone: !!spec.phone }, px: c.x, pz: c.z });
    });
    const crowd = people.map((p) => p.c);

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
    // Sitting (§4): E sits at the nearest free seat, or stands you up. Not while typing.
    const taken = () => new Set(); // Task 11: the commuters' seats on your train
    onKey = (e) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      if (e.target?.closest?.('input, textarea')) return;
      if (rider.seat) stand(rider, walker, clock()); else sit(rider, walker, taken(), clock());
    };
    addEventListener('keydown', onKey);
    hint = document.createElement('div');
    hint.className = 'station-hint';
    hint.textContent = '[E] sit';
    Object.assign(hint.style, { position: 'absolute', left: '50%', bottom: '18%', transform: 'translateX(-50%)', font: '14px monospace', color: '#ffd27a', background: 'rgba(5,6,10,0.7)', padding: '2px 8px', display: 'none', pointerEvents: 'none' });
    stage.append(hint);
    fader = document.createElement('div');
    Object.assign(fader.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none' });
    stage.append(fader);
    const v = new THREE.Vector3();
    const fingerInput = () => {
      v.set(feet.x, feet.y + 0.8, feet.z).project(camera);
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
      if (W < H) {
        camera.fov = fovFor(W / (H * PORTRAIT_CROP));
        camera.setViewOffset(W, H * PORTRAIT_CROP, 0, H * (PORTRAIT_CROP - 1), W, H); // sets the aspect too
      } else {
        camera.aspect = W / H;
        camera.fov = fovFor(camera.aspect);
        camera.clearViewOffset(); // updates the projection
      }
      post.setSize(W, H, dpr);
    };
    resize();
    addEventListener('resize', resize);

    // Other players, and the bar to talk to them (Multiplayer).
    if (mp) {
      others = createOthers(scene, map, { reducedMotion });
      talk = createTalkBar(document.body, { onChat: () => mp.chat(), onEmote: (k) => mp.emote(k) });
    }

    let last = performance.now(), t0 = last, leaving = false, frames = 0, pinned = false;
    const time = () => (performance.now() - t0) / 1000;
    // The train's clock: shared by everyone (Multiplayer), or this station's own once setTime pins it (tests).
    const epoch = () => (mp ? mp.now() : performance.timeOrigin + performance.now());
    const clock = () => (pinned ? time() : sharedTime(epoch()));
    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (document.hidden) { last = now; return; } // paused while hidden (spec §5)
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      const t = (now - t0) / 1000;
      const tt = clock(), trains = trainsAt(tt);
      // Frames (rider.js): board as a standing local's doors close round you, alight as yours open, turn round past the
      // last stop. The camera's spring is kept in your frame, so it moves with you.
      const was = frameOrigin(rider.frame, tt);
      const ev = stepRider(rider, walker, tt);
      if (ev) {
        const now2 = frameOrigin(rider.frame, tt);
        cam.x += was.x - now2.x; cam.z += was.z - now2.z;
        if (ev === 'turn') fader.style.opacity = '1';
      }
      if (rider.fade > 0) { rider.fade = Math.max(0, rider.fade - dt); fader.style.opacity = String(Math.min(1, rider.fade / FADE.in)); }
      const f = rider.frame, m = frameMap(tt);
      const mine = f.kind === 'train' ? local(f.k, tt) : null;
      if (ticket.isOpen) finger = null;
      let input = ticket.isOpen ? STILL : finger ? fingerInput() : keys();
      if (rider.seat && (input.x || input.y)) stand(rider, walker, tt);
      if (rider.seat) input = STILL;
      if (!rider.seat) {
        stepWalker(walker, dt, input, m);
        if (mine) { lurch(walker, mine.accel, dt, m); offPoles(walker, m); }
      }
      walker.y = f.kind === 'train' ? LEVEL.platform : m.levelAt(walker.x, walker.z) ?? walker.y;
      const atMuseum = f.kind === 'station' && f.stop === 0;
      if (atMuseum) {
        pushOut(walker, crowd, m);
        trackGates(gates, walker, t);
        turnRotors(gates, walker);
        swingGates(gates, walker, dt);
        if (!ticket.isOpen) {
          const bump = bumped(gates, walker, input);
          if (bump && armed) { armed = false; walker.vx = walker.vz = 0; refused(gates, bump, t); ticket.open(); } else if (!bump) armed = true;
          const exit = blocked(gates, walker, input);
          if (exit && exitArmed) { exitArmed = false; refused(gates, exit, t); } else if (!exit) exitArmed = true;
        }
        easeArms(gates, walker, dt);
        if (gates.pass !== lastPass) { lastPass = gates.pass; ticket.update(); }
        if (!leaving && map.at(Math.floor(walker.x), Math.floor(walker.z))?.ch === 'E') { leaving = true; onExit(); }
      }
      // Where you are on the line, and the hint.
      const o = frameOrigin(f, tt), wx = o.x + walker.x, wz = o.z + walker.z;
      const standing = f.kind === 'station' ? localsAt(tt).filter((l) => l.at === f.stop) : [];
      const canSit = !rider.seat && (mine ? !!seatNear(walker.x, walker.z) : standing.some((l) => { const to = trainOrigin(l); return !!seatNear(wx - to.x, wz - to.z); }));
      hint.style.display = canSit ? 'block' : 'none';

      // Face where you walk (keeping the last facing when you stop); the stride follows the ground covered,
      // and the gait is a smoothed speed, so starting and stopping blend. Seated, you face across the car.
      const speed = rider.seat ? 0 : Math.hypot(walker.vx, walker.vz);
      if (rider.seat) targetYaw = rider.seat.yaw; else if (speed > 0.3) targetYaw = Math.atan2(walker.vx, walker.vz);
      pose.sit = rider.seat ? 1 : 0;
      pose.yaw = turnToward(pose.yaw, targetYaw, dt);
      pose.gait += (speed / SPEED - pose.gait) * (1 - Math.exp(-dt / GAIT_EASE));
      pose.phase = advancePhase(pose.phase, walker.walked - walked, pose.gait);
      walked = walker.walked;
      pose.t = t;
      poseFigure(pose, joints);
      feet.x = wx; feet.z = wz;
      feet.y = f.kind === 'station' ? footY(maps[f.stop], walker) : LEVEL.platform;
      blob.position.set(feet.x, feet.y + 0.02, feet.z);
      lantern.position.set(feet.x + joints.lantern.x, feet.y + joints.lantern.y, feet.z + joints.lantern.z);
      lantern.intensity = 9 * (reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 13) * Math.sin(t * 5.1));

      // The stations, by where the camera is: each is built the first time it comes near, and hidden while it's away.
      const camX = o.x + cam.x;
      let museumPass = null;
      for (let i = 0; i < 2; i++) {
        const near = stationNear(i, camX);
        if (near && !stations[i]) { groups[i] = new THREE.Group(); groups[i].position.x = STOPS[i].x; scene.add(groups[i]); stations[i] = buildScene(groups[i], maps[i], { reducedMotion }); }
        if (!stations[i]) continue;
        groups[i].visible = near;
        if (!near) continue;
        const here = { x: wx - STOPS[i].x, y: feet.y, z: wz }, pass = passFor(trains, i, maps[i]);
        stations[i].update(t, dt, here, pass, i === 0 ? gates : null, tt);
        if (i === 0) museumPass = pass;
      }
      for (const p of people) {
        const c = stepCommuter(p.c, dt, { train: museumPass, walker: atMuseum ? walker : { x: -1e4, z: -1e4 } }, map);
        p.pose.yaw = c.yaw; p.pose.shift = c.shift; p.pose.t = t + c.home.x; // desynchronised breathing
        // Their rig walks as yours does: the cycle by the ground covered, backward when they step back facing the track.
        stepGait(p.pose, c.x - p.px, c.z - p.pz, dt, COMMUTER.walk);
        p.px = c.x; p.pz = c.z;
        poseFigure(p.pose, p.joints);
        p.at.x = c.x; p.at.y = map.levelAt(c.x, c.z) ?? 0; p.at.z = c.z;
        if (c.phone) {
          const j = p.joints.lantern;
          phoneLight.position.set(c.x + j.x, p.at.y + j.y + 0.05, c.z + j.z + 0.1);
          phoneLight.intensity = 0.45;
        }
      }

      // The camera follows you in your frame; on the bridge, riding, it pulls back to show the city (§4).
      // Inside a car (riding, or in one standing at a platform) it comes in closer, as the car is narrow.
      const inside = !!mine || standing.some((l) => inTrain(l, STOPS[f.stop].x, walker.x, walker.z));
      cam.want = mine && pieceAt(wx).kind === 'bridge' ? CAM.bridge : inside ? CAM.inside : CAM.dist;
      followCamera(cam, walker, dt, f.kind === 'station' ? maps[f.stop] : FREE, camera.aspect);
      const eye = eyeFor(cam), shake = f.kind === 'station' && f.stop === 0 ? world.shake(t, walker, museumPass) : { x: 0, y: 0 };
      camera.position.set(o.x + eye.x + shake.x, eye.y + shake.y, o.z + eye.z);
      camera.lookAt(o.x + cam.x + shake.x, cam.y + shake.y, o.z + cam.z);
      figure.update(joints, camera, feet);
      for (const p of people) p.figure.update(p.joints, camera, p.at);
      trainView.update(trains, { me: { x: wx, z: wz }, mine: mine ? mine.id : null, time: t, dt, sun: 1 });
      audio.update({ t, dt, walker, pose, gates, train: museumPass, pigeons: world.pigeons, rats: world.rats, people });
      if (others) {
        others.update(mp.list(now), now, dt, t, camera, feet);
        mp.tick({ x: feet.x, z: feet.z, y: feet.y, a: pose.yaw });
      }
      v.set(feet.x, feet.y + 0.8, feet.z).project(camera);
      post.setFocus((v.y + 1) / 2);
      post.render();
      frames++;
    }
    raf = requestAnimationFrame(frame);

    hook = {
      map, walker,
      frames: () => frames,
      time,
      train: () => passFor(trainsAt(clock()), 0, map),
      trains: () => trainsAt(clock()),
      shownTrains: () => trainView.shown(),
      clock,
      setTime(s) { t0 = performance.now() - s * 1000; pinned = true; },
      others: () => (others ? others.shown() : []),
      mine: () => (others ? others.mine() : null),
      teleport(x, z, stop = 0) { rider.frame = { kind: 'station', stop }; rider.seat = null; walker.x = x; walker.z = z; walker.vx = walker.vz = 0; walker.y = maps[stop].levelAt(x, z) ?? walker.y; },
      board(k, x, z) { rider.frame = { kind: 'train', k }; rider.seat = null; walker.x = x; walker.z = z; walker.vx = walker.vz = 0; },
      frame: () => ({ ...rider.frame }),
      aboard: () => (rider.frame.kind === 'train' ? { k: rider.frame.k, x: walker.x, z: walker.z, seat: rider.seat?.i ?? null } : null),
      world: () => ({ x: feet.x, y: feet.y, z: feet.z }),
      sit: () => sit(rider, walker, taken(), clock()),
      stand: () => stand(rider, walker, clock()),
      setWallet(cents) { gates.wallet = cents; },
      gates: () => ({ wallet: gates.wallet, pass: gates.pass, used: gates.used, open: gates.gates.map((g) => g.open), popup: ticket.isOpen,
        kind: gates.gates.map((g) => g.kind), ring: gates.gates.map((g, i) => ringState(gates, i, walker, time())), rotor: gates.gates.map(rotorTurns),
        swing: gates.gates.map((g) => g.swing), alarm: gates.gates.some((g) => alarmOn(gates, g, time())) }),
      audio: () => audio.state(),
      life: () => ({ pigeons: world.pigeons.map((p) => p.s.state), rats: world.rats.map((r) => r.s.state), commuters: crowd.map((c) => ({ x: c.x, z: c.z, yaw: c.yaw })) }),
    };
    window.__station = hook;

    return {
      // What I said or emoted, over my head at once.
      say(text) { others?.say(text, performance.now()); },
      pos: () => ({ x: feet.x, z: feet.z, y: feet.y, a: pose.yaw }),
      emote(kind) { others?.emote(kind, performance.now()); },
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
