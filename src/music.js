// Smooth jazz in the museum, drifting down the station's exit stairs (station spec §8). main.js imports this on the
// visitor's first key press or tap, so the gallery's first load carries none of it, and calls unlock() on that gesture
// and every later one: the first makes the AudioContext and starts the track loading (assets/music, CC0, see
// CREDITS.md); a later one resumes the context if the browser held it back.
//
// One context and one looping source for the whole visit. The station doesn't play its own copy: it moves this one
// (place(): quieter, muffled, panned toward the stairs), and coming back up it eases back. So going down and up never
// restarts the track or clicks, and the playback position carries on. Paused while the tab is hidden.
import trackUrl from './rpg/assets/music/smooth-104.mp3';
import { isMuted, onMuted } from './sound-pref.js';

export const LOOP = (20 * 4 * 60) / 104; // the track: 20 bars of 4 at 104 bpm, looped whole
export const GALLERY = { gain: 0.16, cutoff: 16000, pan: 0 }; // background level in the museum
export const ARRIVING = { gain: 0.1, cutoff: 1100, pan: -0.4 }; // at the foot of the stairs, before the station places it

let ctx = null, out = null, filter = null, panner = null, source = null, sources = 0, unsubscribe = null;
let mix = { ...GALLERY }, scene = 'gallery', muted = false;

export function unlock({ where } = {}) {
  if (ctx) { if (ctx.state === 'suspended' && !document.hidden) ctx.resume().catch(() => {}); return; }
  const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!AC) return;
  try { start(new AC(), { where: where || scene }); } catch { ctx = null; }
}

function start(context, { where = 'gallery' } = {}) {
  ctx = context;
  scene = where;
  mix = where === 'gallery' ? { ...GALLERY } : { ...ARRIVING };
  muted = isMuted();
  filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.Q.value = 0.4;
  filter.frequency.value = mix.cutoff;
  panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  out = ctx.createGain();
  out.gain.value = 0;
  if (panner) filter.connect(panner).connect(out); else filter.connect(out);
  out.connect(ctx.destination);
  unsubscribe = onMuted((m) => { muted = m; apply(0.15); });
  document.addEventListener('visibilitychange', onVisible);
  load();
}

async function load() {
  try {
    const res = await fetch(trackUrl);
    if (!res.ok) return;
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    if (source || !ctx) return;
    source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.loopStart = 0;
    source.loopEnd = Math.min(LOOP, buffer.duration);
    source.connect(filter);
    source.onended = () => { sources--; };
    source.start();
    sources++;
    apply(1.5); // fades in
  } catch { /* no music, silently */ }
}

// Ease the music toward the current mix, over about `ramp` seconds.
function apply(ramp) {
  if (!ctx) return;
  const t = ctx.currentTime, k = Math.max(0.01, ramp / 3);
  out.gain.setTargetAtTime(muted || !source ? 0 : mix.gain, t, k);
  filter.frequency.setTargetAtTime(mix.cutoff, t, k);
  panner?.pan.setTargetAtTime(mix.pan, t, k);
}

// Where the music is heard from: 'gallery' (all of it, in the museum) or 'station' (the station places it).
export function setScene(where) {
  scene = where;
  if (where === 'gallery') { mix = { ...GALLERY }; apply(1.2); } else { mix = { ...ARRIVING }; apply(0.6); }
}
// The station, each frame: how loud, how muffled and from where you hear it ({ gain, cutoff, pan }).
export function place(m, ramp = 0.3) {
  if (scene !== 'station') return;
  mix = { gain: m.gain, cutoff: m.cutoff, pan: m.pan ?? 0 };
  apply(ramp);
}

function onVisible() {
  if (!ctx) return;
  if (document.hidden) ctx.suspend().catch(() => {});
  else ctx.resume().catch(() => {});
}

// Test hook (main.js puts it on window.__ascii.music): the context's state, how many sources play, and the mix.
export const musicState = () => ({ state: ctx ? ctx.state : 'none', sources, loaded: !!source, scene, muted, gain: mix.gain, cutoff: mix.cutoff, at: ctx ? ctx.currentTime : 0 });

