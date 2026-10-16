// Noir jazz in the museum, drifting down the station's exit stairs (station spec §8). main.js imports this on the
// visitor's first key press or tap, so the gallery's first load carries none of it, and calls unlock() on that gesture
// and every later one: the first makes the AudioContext and starts the track loading; a later one resumes the context
// if the browser held it back. The track is noir jazz, one of three (track-choice.js: ?track=1, the default, 2 or 3;
// all CC BY 4.0, the playing one credited in the map and the sound button's tooltip; see CREDITS.md). Only the
// chosen one is fetched.
//
// One context and one looping source for the whole visit. The station doesn't play its own copy: it moves this one
// (place(): quieter, muffled, panned toward the stairs), and coming back up it eases back. So going down and up never
// restarts the track or clicks, and the playback position carries on. Paused while the tab is hidden.
import { isMuted, onMuted } from './sound-pref.js';
import { TRACKS, trackIndex } from './track-choice.js';

// The track plays its start once, then loops [LOOP_START, LOOP_END), whose seam is crossfaded into the file.
export const TRACK = TRACKS[trackIndex()];
export const LOOP_START = TRACK.loopStart;
export const LOOP_END = TRACK.loopEnd;
// Each a literal URL, not an import, so nothing loads but the chosen file (Vite still bundles all three).
const URLS = {
  'signs-to-nowhere': () => new URL('./rpg/assets/music/signs-to-nowhere.mp3', import.meta.url).href,
  'spy-glass': () => new URL('./rpg/assets/music/spy-glass.mp3', import.meta.url).href,
  'covert-affair': () => new URL('./rpg/assets/music/covert-affair.mp3', import.meta.url).href,
};
const trackUrl = URLS[TRACK.file]();
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
    source.loopStart = LOOP_START;
    source.loopEnd = Math.min(LOOP_END, buffer.duration);
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
export const musicState = () => ({ track: TRACK.file, state: ctx ? ctx.state : 'none', sources, loaded: !!source, scene, muted, gain: mix.gain, cutoff: mix.cutoff, at: ctx ? ctx.currentTime : 0 });

