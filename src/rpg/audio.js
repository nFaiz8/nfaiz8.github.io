// The station's sound (station spec §8): Web Audio, made with the station and closed with it.
//
// A small mixer: master (through a gentle compressor) ← ambience, effects and train buses, with a shared reverb for
// the tiled space. Each sound is placed by its distance from you and a stereo pan by how far east or west of you it
// is (sound.js `spatial`: the camera looks north from behind you, so east is right); you are the listener. Most
// of it is synthesized (the hum, the faulty tube's buzz, the steam, the city, the train's rumble, roar and wind, the
// clatter, the beeps, the alarm and the PA); a few small CC0 recordings (assets/sound, CREDITS.md) load after the
// station starts, and one that fails to load is just skipped.
//
// Nothing plays until a key press or tap after you arrive (the context is resumed on that gesture). M (or V, the
// gallery's key) and the speaker button mute it, remembered with the museum's music (sound-pref.js). The museum's
// jazz is music.js's: from here it is only placed, drifting down the exit stairs. Hidden tab: suspended.
// Reduced motion: everything plays, but the alarm sounds once, briefly, instead of looping, and the train is softer.
import { isMuted, setMuted, onMuted } from '../sound-pref.js';
import { place as placeMusic } from '../music.js';
import { footfall, surfaceAt, spatial, trainSound, knocks, announcementsBetween, stairsMusic, rotorClicks, tubeFault, tubeStutter, dripLanded } from './sound.js';
import { alarmOn, ringState, isEmergency } from './gates.js';
import { LEVEL } from './map.js';
import { rng } from './life.js';

const FILES = import.meta.glob('./assets/sound/*.mp3', { eager: true, query: '?url', import: 'default' });

// Levels: gentle by default. The buses' gains, and each layer's at full.
export const MIX = { master: 0.5, ambience: 0.6, effects: 0.85, train: 0.9, softTrain: 0.5, reverb: 0.3 };
const LAYER = { city: 0.05, cityRec: 0.12, bed: 1.1, hum: 0.05, buzz: 0.012, buzzStutter: 0.05, hiss: 0.07, rumble: 0.75, roar: 0.45, screech: 0.3, wind: 0.35 };
const SURFACE = { tile: 'step-tile', concrete: 'step-grit', stairs: 'step-hollow' };
const GUSTY = 0.15; // the torn poster flaps in a wind stronger than this

export function createStationAudio({ map, sources = {}, reducedMotion = false, parent = document.body, context = null, ui = true }) {
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  let ctx = context;
  try { if (!ctx && AC) ctx = new AC(); } catch { ctx = null; }
  const own = !context;
  const cleanups = [];
  const listen = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); cleanups.push(() => target.removeEventListener(type, fn, opts)); };

  // The speaker button, top right (station spec §8).
  let button = null;
  const showMuted = (m) => {
    if (!button) return;
    button.textContent = m ? '◀ ×' : '◀))';
    button.setAttribute('aria-pressed', String(m));
    button.title = m ? 'Sound off (M)' : 'Sound on (M)';
  };
  if (ui) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'sound-toggle';
    button.setAttribute('aria-label', 'Mute sound (M)');
    parent.append(button);
    showMuted(isMuted());
    listen(button, 'click', (e) => { e.stopPropagation(); setMuted(!isMuted()); button.blur(); });
  }

  let unlocked = false, alive = true;
  const stub = { update() {}, ticket() {}, unlock() {}, state: () => ({ state: 'none', unlocked: false, muted: isMuted() }), stop() { for (const c of cleanups.splice(0)) c(); button?.remove(); } };
  if (!ctx) return stub;

  // ── The mixer ──
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12; comp.knee.value = 8; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.2;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(comp);
  const busGain = (v) => { const g = ctx.createGain(); g.gain.value = v; g.connect(master); return g; };
  const amb = busGain(MIX.ambience), fx = busGain(MIX.effects), trainBus = ctx.createGain();
  trainBus.gain.value = reducedMotion ? MIX.softTrain : MIX.train;
  const trainTone = ctx.createBiquadFilter(); // the walls between the hall and the tracks muffle the train
  trainTone.type = 'lowpass'; trainTone.frequency.value = 16000;
  trainBus.connect(trainTone).connect(master);
  const reverb = ctx.createConvolver();
  reverb.buffer = impulse(ctx, 1.7, 2.6);
  const wet = ctx.createGain(); wet.gain.value = MIX.reverb;
  reverb.connect(wet).connect(master);
  const send = (node, amount) => { const s = ctx.createGain(); s.gain.value = amount; node.connect(s).connect(reverb); };
  send(fx, 0.45); send(trainBus, 0.25); send(amb, 0.25);

  const muted = () => isMuted();
  const applyMaster = (ramp = 0.08) => master.gain.setTargetAtTime(unlocked && !muted() ? MIX.master : 0, ctx.currentTime, ramp);
  cleanups.push(onMuted((m) => { showMuted(m); applyMaster(); }));

  // ── Sources ──
  const noise = noiseBuffer(ctx, 3, false), brown = noiseBuffer(ctx, 4, true);
  const click = clickBuffer(ctx), crackle = crackleBuffer(ctx);
  const panNode = () => (ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain());
  const setPan = (p, v, k = 0.05) => p.pan?.setTargetAtTime(v, ctx.currentTime, k);
  // A continuous voice: source(s) → [filters] → gain → pan → bus. set() eases its level and pan.
  const voices = [];
  function voice(bus, build) {
    const g = ctx.createGain(); g.gain.value = 0;
    const p = panNode();
    g.connect(p).connect(bus);
    const v = { g, p, nodes: build(g), set(level, pan = 0, k = 0.06) { g.gain.setTargetAtTime(Math.max(0, level), ctx.currentTime, k); setPan(p, pan, k); } };
    voices.push(v);
    return v;
  }
  const loopSrc = (buffer, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; s.playbackRate.value = rate; s.start(); return s; };
  const filt = (type, f, q = 0.7) => { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
  const osc = (type, f) => { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.start(); return o; };

  let city, hum, buzz, hiss, rumble, roar, wind, screech = null, roarTone, windTone;
  function startAmbience() {
    city = voice(amb, (g) => { const s = loopSrc(brown, 0.8), f = filt('lowpass', 240); s.connect(f).connect(g); return [s]; });
    hum = voice(amb, (g) => {
      const mixG = ctx.createGain(); mixG.connect(g);
      return [[120, 'sine', 0.6], [240, 'sine', 0.22], [360, 'triangle', 0.08]].map(([f, type, a]) => { const o = osc(type, f), k = ctx.createGain(); k.gain.value = a; o.connect(k).connect(mixG); return o; });
    });
    buzz = voice(amb, (g) => { const o = osc('sawtooth', 120), f = filt('bandpass', 2600, 1.6); o.connect(f).connect(g); return [o]; });
    hiss = voice(amb, (g) => { const s = loopSrc(noise, 1), a = filt('highpass', 2800), b = filt('lowpass', 9000); s.connect(a).connect(b).connect(g); return [s]; });
    rumble = voice(trainBus, (g) => { const s = loopSrc(brown, 1), f = filt('lowpass', 130, 0.9); s.connect(f).connect(g); return [s]; });
    roar = voice(trainBus, (g) => { const s = loopSrc(noise, 0.9); roarTone = filt('bandpass', 700, 0.5); const f = filt('lowpass', 4500); s.connect(roarTone).connect(f).connect(g); return [s]; });
    wind = voice(trainBus, (g) => { const s = loopSrc(noise, 1.1); windTone = filt('bandpass', 600, 0.9); s.connect(windTone).connect(g); return [s]; });
    startRecorded();
  }
  // The recorded layers, once they've loaded: the screech, the train's wheels-and-roar bed, the city above.
  let bed = null, cityRec = null;
  const recLoop = (bus, name, len, build) => voice(bus, (g) => {
    const s = ctx.createBufferSource(); s.buffer = bufs[name][0]; s.loop = true; s.loopStart = 0; s.loopEnd = Math.min(len, s.buffer.duration);
    (build ? build(s) : s).connect(g); s.start(); return [s];
  });
  function startRecorded() {
    if (!rumble) return;
    if (bufs.screech) startScreech();
    if (bufs['train-bed'] && !bed) bed = recLoop(trainBus, 'train-bed', 4);
    if (bufs.city && !cityRec) cityRec = recLoop(amb, 'city', 8, (s) => { const f = filt('lowpass', 900); s.connect(f); return f; });
  }
  function startScreech() {
    if (screech || !rumble) return;
    screech = voice(trainBus, (g) => {
      const s = ctx.createBufferSource(); s.buffer = bufs.screech[0]; s.loop = true; s.loopStart = 0.5; s.loopEnd = Math.min(4.3, s.buffer.duration);
      const f = filt('highpass', 1400); s.connect(f).connect(g); s.start(); return [s];
    });
  }

  // ── Recordings, loaded after start ──
  const bufs = {};
  (async () => {
    await Promise.all(Object.entries(FILES).map(async ([path, url]) => {
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const b = await ctx.decodeAudioData(await res.arrayBuffer());
        if (!alive) return;
        const name = path.split('/').pop().replace(/\.mp3$/, '').replace(/-\d+$/, '');
        (bufs[name] ||= []).push(b);
      } catch { /* skipped */ }
    }));
    if (alive && unlocked) startRecorded();
  })();

  // ── One-shots ──
  const r = rng(91);
  const between = (a, b) => a + (b - a) * r();
  let me = { x: 0, y: 0, z: 0 };
  // A recording (a random take of it), at a place or (no x) right on you.
  function play(name, { x, y, z, gain = 0.5, rate = 1, bus = fx, ref = 3, when = 0 } = {}) {
    const list = bufs[name];
    if (!list || !unlocked) return null;
    return shot(list[Math.floor(r() * list.length)], { x, y, z, gain, rate, bus, ref, when });
  }
  function shot(buffer, { x, y, z, gain = 0.5, rate = 1, bus = fx, ref = 3, when = 0 } = {}) {
    const at = x == null ? { gain: 1, pan: 0 } : spatial(x, y, z, me, ref);
    const level = gain * at.gain;
    if (level < 0.004) return null;
    const s = ctx.createBufferSource(); s.buffer = buffer; s.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = level;
    const p = panNode(); if (p.pan) p.pan.value = at.pan;
    s.connect(g).connect(p).connect(bus);
    s.onended = () => { s.disconnect(); g.disconnect(); p.disconnect(); };
    s.start(ctx.currentTime + when);
    return s;
  }
  // A short tone: a beep, a chime note, a buzz.
  function tone(freq, { at = 0, dur = 0.08, type = 'sine', gain = 0.1, x, y, z, bus = fx, decay = false, cutoff = 0 } = {}) {
    if (!unlocked) return;
    const pos = x == null ? { gain: 1, pan: 0 } : spatial(x, y, z, me, 4);
    const t0 = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain(), p = panNode();
    o.type = type; o.frequency.value = freq;
    if (p.pan) p.pan.value = pos.pan;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain * pos.gain, t0 + 0.006);
    if (decay) g.gain.setTargetAtTime(0, t0 + 0.01, dur / 3);
    else { g.gain.setValueAtTime(gain * pos.gain, t0 + dur - 0.012); g.gain.linearRampToValueAtTime(0, t0 + dur); }
    let head = o;
    if (cutoff) { const f = filt('lowpass', cutoff); o.connect(f); head = f; }
    head.connect(g).connect(p).connect(bus);
    o.start(t0); o.stop(t0 + dur * (decay ? 4 : 1) + 0.02);
    o.onended = () => { o.disconnect(); g.disconnect(); p.disconnect(); };
  }

  // The PA: a three-note chime, then a muffled, garbled voice (no words) with the station's echo.
  function announce(k) {
    const t0 = ctx.currentTime, rr = rng(500 + k);
    [784, 659, 523].forEach((f, i) => { tone(f, { at: i * 0.42, dur: 1.1, gain: 0.06, decay: true, bus: amb }); tone(f * 2, { at: i * 0.42, dur: 0.5, gain: 0.012, decay: true, bus: amb }); });
    const start = t0 + 1.6, len = 2.6 + rr() * 1.4;
    const voiceOsc = ctx.createOscillator(); voiceOsc.type = 'sawtooth';
    const breath = ctx.createBufferSource(); breath.buffer = noise; breath.loop = true;
    const hissG = ctx.createGain(); hissG.gain.value = 0.25;
    const f1 = filt('bandpass', 600, 6), f2 = filt('bandpass', 1500, 7), env = ctx.createGain(), lp = filt('lowpass', 1500), hp = filt('highpass', 280);
    const echo = ctx.createDelay(1), fb = ctx.createGain(), out = ctx.createGain();
    echo.delayTime.value = 0.21; fb.gain.value = 0.33; out.gain.value = 0.55;
    voiceOsc.connect(f1); voiceOsc.connect(f2); breath.connect(hissG); hissG.connect(f2);
    f1.connect(env); f2.connect(env);
    env.connect(lp).connect(hp).connect(out);
    hp.connect(echo); echo.connect(fb).connect(echo); echo.connect(out);
    out.connect(amb);
    env.gain.setValueAtTime(0, t0);
    let t = start, f0 = 150, n = 0;
    while (t < start + len) {
      const syl = 0.11 + rr() * 0.16;
      voiceOsc.frequency.setTargetAtTime(f0 * (0.92 + rr() * 0.16), t, 0.03);
      f1.frequency.setTargetAtTime(350 + rr() * 500, t, 0.02);
      f2.frequency.setTargetAtTime(900 + rr() * 1400, t, 0.02);
      env.gain.setTargetAtTime(0.9, t, 0.015);
      env.gain.setTargetAtTime(0.12, t + syl * 0.7, 0.02);
      t += syl; n++;
      f0 *= 0.995; // the voice falls a little through a sentence
      if (n % (4 + Math.floor(rr() * 4)) === 0) { env.gain.setTargetAtTime(0, t, 0.03); t += 0.18 + rr() * 0.25; f0 = 140 + rr() * 20; }
    }
    env.gain.setTargetAtTime(0, t, 0.04);
    voiceOsc.start(start); breath.start(start);
    voiceOsc.stop(t + 0.3); breath.stop(t + 0.3);
    voiceOsc.onended = () => setTimeout(() => { for (const nd of [voiceOsc, breath, hissG, f1, f2, env, lp, hp, echo, fb, out]) nd.disconnect(); }, 2000);
  }

  // The emergency gate's alarm: two harsh tones swapping three times a second (with the light) for as long as it
  // sounds; with reduced motion one short burst.
  let alarmNodes = null, lastAlarm = null;
  function alarm(gate, secs) {
    stopAlarm();
    const t0 = ctx.currentTime, len = reducedMotion ? 0.6 : secs;
    const o = ctx.createOscillator(), f = filt('lowpass', 2600), g = ctx.createGain(), p = panNode();
    o.type = 'square';
    for (let i = 0, t = 0; t < len; i++, t += 1 / 6) o.frequency.setValueAtTime(i % 2 ? 740 : 980, t0 + t);
    const pos = spatial(gate.x, LEVEL.hall + 2.2, gate.z, me, 5);
    if (p.pan) p.pan.value = pos.pan;
    const level = 0.07 * Math.max(0.35, pos.gain);
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.02);
    g.gain.setValueAtTime(level, t0 + len - 0.05); g.gain.linearRampToValueAtTime(0, t0 + len);
    o.connect(f).connect(g).connect(p).connect(fx);
    o.start(t0); o.stop(t0 + len + 0.02);
    alarmNodes = { o, f, g, p };
    o.onended = () => { for (const nd of [o, f, g, p]) nd.disconnect(); if (alarmNodes?.o === o) alarmNodes = null; };
  }
  function stopAlarm() { if (alarmNodes) { try { alarmNodes.o.stop(); } catch {} alarmNodes = null; } }

  // The fare card machine's bleeps (ticket.js onSound).
  function ticket(name) {
    if (name === 'select') tone(1320, { dur: 0.045, type: 'square', gain: 0.03, cutoff: 3000 });
    else if (name === 'open') { tone(990, { dur: 0.05, type: 'square', gain: 0.03, cutoff: 3000 }); tone(1320, { at: 0.07, dur: 0.05, type: 'square', gain: 0.03, cutoff: 3000 }); }
    else if (name === 'bought') [1047, 1319, 1568, 2093].forEach((f, i) => tone(f, { at: i * 0.09, dur: 0.5, gain: 0.07, decay: true }));
    else if (name === 'funds') { tone(330, { dur: 0.12, type: 'square', gain: 0.04, cutoff: 1200 }); tone(262, { at: 0.16, dur: 0.18, type: 'square', gain: 0.04, cutoff: 1200 }); }
    else if (name === 'topup') { tone(1568, { dur: 0.07, gain: 0.06 }); tone(2093, { at: 0.08, dur: 0.12, gain: 0.06 }); }
    else if (name === 'close') tone(660, { dur: 0.05, type: 'square', gain: 0.025, cutoff: 2500 });
  }

  // ── The gesture that unlocks it, the mute key, and the hidden tab ──
  function unlock() {
    if (!alive) return;
    if (!unlocked) {
      unlocked = true;
      startAmbience();
    }
    if (ctx.state === 'suspended' && !document.hidden) ctx.resume?.().catch(() => {});
    applyMaster(0.3);
  }
  const editable = (e) => e.target?.closest?.('input, textarea, [contenteditable]');
  if (ui) {
    listen(globalThis, 'keydown', (e) => {
      if (editable(e)) return;
      unlock();
      if ((e.code === 'KeyM' || e.code === 'KeyV') && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) setMuted(!isMuted());
    }, true);
    listen(globalThis, 'pointerdown', unlock, true);
    listen(document, 'visibilitychange', () => {
      if (document.hidden) ctx.suspend?.().catch(() => {});
      else if (unlocked) ctx.resume?.().catch(() => {});
    });
  }

  // ── Each frame ──
  let lastT = null, lastPhase = null, lastFault = 1, lastHead = null, lastTrainN = -1, flapIn = 0;
  const gateWas = new Map(), pigeonWas = new Map(), ratWas = new Map(), peopleWas = new Map();
  let noteWas = null;
  function update({ t, dt, walker, pose, gates, train, pigeons = [], rats = [], people = [] }) {
    me = { x: walker.x, y: walker.y, z: walker.z };
    // The museum's music down the exit stairs (placed even before the gesture: it's music.js's, already playing).
    placeMusic(stairsMusic(walker, map.exits));
    const jump = lastT == null || t < lastT || t - lastT > 0.5; // the clock was set (tests) or the tab slept
    const t0 = jump ? t : lastT;
    lastT = t;
    if (!unlocked) { lastPhase = pose.phase; return; }

    // Ambience.
    city.set(LAYER.city * (cityRec ? 0.5 : 1) * (0.85 + 0.15 * Math.sin(t * 0.13)), 0, 0.5);
    cityRec?.set(LAYER.cityRec, 0, 0.5);
    let nearTube = null;
    for (const tb of sources.tubes || []) { const s = spatial(tb.x, tb.y, tb.z, me, 2.5); if (!nearTube || s.gain > nearTube.gain) nearTube = s; }
    if (nearTube) hum.set(LAYER.hum * nearTube.gain, nearTube.pan * 0.5, 0.2);
    const fault = sources.fault;
    if (fault) {
      const s = spatial(fault.x, fault.y, fault.z, me, 2.5);
      const k = reducedMotion ? 1 : tubeFault(t), stutter = !reducedMotion && tubeStutter(t);
      buzz.set((stutter ? LAYER.buzzStutter : LAYER.buzz) * s.gain * (k > 0.5 ? 1 : 0.25), s.pan, 0.015);
      if (k !== lastFault && !jump) shot(crackle, { x: fault.x, y: fault.y, z: fault.z, gain: 0.35, rate: between(0.8, 1.3), bus: amb, ref: 2.5 });
      lastFault = k;
    }
    if (sources.vent) {
      const v = sources.vent, s = spatial(v.x, LEVEL.hall + 0.3, v.z, me, 1.8);
      hiss.set(LAYER.hiss * s.gain * (0.6 + 0.4 * Math.sin(t * 0.6)), s.pan, 0.2);
    }
    if (!jump) (sources.puddles || []).forEach((p, i) => { if (dripLanded(i, t0, t)) play('drip', { x: p.x, y: p.y, z: p.z, gain: 0.5, rate: between(0.85, 1.2), ref: 2.5 }); });
    if (!jump) for (const k of announcementsBetween(t0, t, map)) announce(k);

    // The train.
    const ts = trainSound(t, map, me);
    trainTone.frequency.setTargetAtTime(700 + 15000 * ts.muffle ** 2, ctx.currentTime, 0.2);
    rumble.set(LAYER.rumble * ts.rumble, ts.pan, 0.12);
    roar.set(LAYER.roar * ts.roar * (bed ? 0.35 : 1), ts.pan, 0.05);
    bed?.set(LAYER.bed * ts.roar, ts.pan, 0.05);
    roarTone.frequency.setTargetAtTime(500 + 900 * ts.roar, ctx.currentTime, 0.05);
    wind.set(LAYER.wind * ts.wind, ts.pan * 0.7, 0.1);
    windTone.frequency.setTargetAtTime(450 + 900 * ts.wind, ctx.currentTime, 0.1);
    screech?.set(LAYER.screech * ts.screech * (reducedMotion ? 0.5 : 0.6 + 0.4 * Math.sin(t * 2.3) ** 2), ts.pan, 0.06);
    if (train && train.phase === 'pass') {
      if (train.n === lastTrainN && lastHead != null && !jump) {
        for (const x of knocks(lastHead, train.head, train.dir)) {
          if (x < -1 || x > map.cols + 1) continue;
          shot(click, { x, y: train.track.y, z: train.track.z, gain: 0.5, rate: between(0.85, 1.15), bus: trainBus, ref: 5 });
        }
      }
      lastHead = train.head; lastTrainN = train.n;
      // The torn poster flaps in a north-track train's wind (as scene.js shows it).
      const pp = sources.poster;
      const gust = pp && train.track === map.tracks[0] ? Math.max(0, 1 - Math.abs(train.head - pp.x) / 14) : 0;
      flapIn -= dt;
      if (gust > GUSTY && flapIn <= 0) { play('cloth', { x: pp.x, y: pp.y, z: pp.z, gain: 0.9 * gust, rate: between(0.9, 1.3), ref: 5 }); flapIn = between(0.07, 0.22); }
    } else lastHead = null;

    // You: a step each time a foot comes down, on what you're walking on.
    if (footfall(lastPhase, pose.phase) && pose.gait > 0.15) {
      const sfc = surfaceAt(map, walker.x, walker.z);
      if (sfc) play(SURFACE[sfc], { gain: 0.3 * (0.7 + 0.3 * Math.min(1, pose.gait)), rate: between(0.94, 1.06) * (sfc === 'tile' ? 1.08 : 1) });
    }
    lastPhase = pose.phase;

    // The turnstiles and the emergency gate.
    if (gates) gates.gates.forEach((k, i) => {
      const was = gateWas.get(k) || { push: 0, swing: 0, ring: 'idle' };
      const y = LEVEL.hall + 1;
      if (isEmergency(k)) {
        if (was.swing < 0.01 && k.swing >= 0.01) { play('clank', { x: k.x, y, z: k.z, gain: 0.6 }); play('latch', { x: k.x, y, z: k.z, gain: 0.45, when: 0.05 }); }
      } else {
        for (const c of rotorClicks(was.push, k.push)) {
          if (c === 'tick') play('ratchet', { x: k.x, y, z: k.z, gain: 0.4, rate: between(0.95, 1.1) });
          else play('clunk', { x: k.x, y, z: k.z, gain: c === 'over' ? 0.55 : 0.3, rate: c === 'over' ? 0.9 : 1.15 });
        }
        const ring = ringState(gates, i, walker, t);
        if (ring === 'go' && was.ring !== 'go') { tone(1760, { dur: 0.07, gain: 0.05, x: k.x, y, z: k.z }); tone(2349, { at: 0.11, dur: 0.09, gain: 0.05, x: k.x, y, z: k.z }); }
        was.ring = ring;
      }
      was.push = k.push; was.swing = k.swing;
      gateWas.set(k, was);
    });
    if (gates && gates.note && gates.note !== noteWas) { // walked into a locked gate: a low buzz
      const k = gates.note.gate;
      tone(110, { dur: 0.32, type: 'sawtooth', gain: 0.08, cutoff: 900, x: k.x, y: LEVEL.hall + 1, z: k.z });
      tone(116, { dur: 0.32, type: 'sawtooth', gain: 0.05, cutoff: 900, x: k.x, y: LEVEL.hall + 1, z: k.z });
    }
    noteWas = gates?.note ?? null;
    if (gates && gates.alarm && gates.alarm !== lastAlarm && alarmOn(gates, gates.alarm.gate, t)) alarm(gates.alarm.gate, gates.alarm.until - t);
    lastAlarm = gates?.alarm ?? null;

    // Life.
    for (const p of pigeons) {
      const s = p.s, was = pigeonWas.get(p) || { state: s.state, coo: between(2, 9) };
      const y = LEVEL.platform + s.y;
      if (s.state === 'fly' && was.state !== 'fly') play('wings', { x: s.x, y, z: s.z, gain: 0.55, rate: between(0.95, 1.12) });
      if (s.state === 'land' && was.state !== 'land') play('wings', { x: s.x, y, z: s.z, gain: 0.3, rate: between(1, 1.2) });
      was.coo -= dt;
      if (was.coo <= 0) { if (s.state === 'peck') play('coo', { x: s.x, y, z: s.z, gain: 0.32, rate: between(0.9, 1.1) }); was.coo = between(6, 15); }
      was.state = s.state;
      pigeonWas.set(p, was);
    }
    for (const rt of rats) {
      const s = rt.s, was = ratWas.get(rt) || { state: s.state, squeak: between(3, 10) };
      if (s.visible) {
        if (s.state === 'flee' && was.state !== 'flee') play('squeak', { x: s.x, y: LEVEL.track, z: s.z, gain: 0.4, rate: between(1, 1.25) });
        was.squeak -= dt;
        if (was.squeak <= 0) { if (s.state === 'roam') play('squeak', { x: s.x, y: LEVEL.track, z: s.z, gain: 0.25, rate: between(0.9, 1.3) }); was.squeak = between(5, 12); }
      }
      was.state = s.state;
      ratWas.set(rt, was);
    }
    for (const p of people) { // faint footsteps when they walk
      const prev = peopleWas.get(p);
      if (prev != null && footfall(prev, p.pose.phase) && p.pose.gait > 0.15) {
        const sfc = surfaceAt(map, p.c.x, p.c.z);
        if (sfc) play(SURFACE[sfc], { x: p.c.x, y: map.levelAt(p.c.x, p.c.z) ?? 0, z: p.c.z, gain: 0.14, rate: between(0.9, 1.05), ref: 2.5 });
      }
      peopleWas.set(p, p.pose.phase);
    }
  }

  return {
    update,
    ticket,
    unlock,
    get context() { return ctx; },
    state: () => ({ state: ctx.state, unlocked, muted: muted(), loaded: Object.keys(bufs).length }),
    stop() {
      alive = false;
      for (const c of cleanups.splice(0)) c();
      button?.remove();
      stopAlarm();
      for (const v of voices) for (const n of v.nodes) { try { n.stop?.(); } catch {} }
      if (own) ctx.close?.().catch(() => {});
    },
  };
}

// ── Made-up sounds ──
// White or brown noise, for loops.
function noiseBuffer(ctx, secs, brown) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
  const r = rng(brown ? 7 : 3);
  let last = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w * 0.5;
  }
  // Fade the ends into each other so the loop doesn't click.
  const f = Math.min(2048, n >> 3);
  for (let i = 0; i < f; i++) { const k = i / f; d[n - f + i] = d[n - f + i] * (1 - k) + d[i] * k; }
  return b;
}
// The tiled space: a stereo burst of noise decaying over `secs`.
function impulse(ctx, secs, decay) {
  const n = Math.floor(ctx.sampleRate * secs), b = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c), r = rng(11 + c);
    for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * (1 - i / n) ** decay;
  }
  return b;
}
// A wheel over a rail joint: a sharp knock with a low thump under it.
function clickBuffer(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.09), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rng(5);
  let lp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    lp += 0.35 * ((r() * 2 - 1) - lp);
    d[i] = 0.7 * lp * Math.exp(-t / 0.008) + 0.6 * Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t / 0.025);
  }
  return b;
}
// The faulty tube's crackle: a short, bright spit.
function crackleBuffer(ctx) {
  const sr = ctx.sampleRate, n = Math.floor(sr * 0.04), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0), r = rng(9);
  for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.exp(-i / sr / 0.005) * (r() < 0.3 ? 1 : 0.3);
  return b;
}
