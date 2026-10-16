// The sound setting, one for the whole site: the museum's music and the station's sound are on unless you've muted
// them, and muting either mutes both. Kept in localStorage, which may be missing or throw (a private window, blocked
// site data), so every access is wrapped and the default (on) stands. Tiny on purpose: the gallery's first load
// carries this and nothing else of the audio.
export const MUTE_KEY = 'faiz.sound';
export const parseMuted = (raw) => raw === 'off'; // anything else (nothing stored, garbage) is on
export const formatMuted = (muted) => (muted ? 'off' : 'on');

const store = () => { try { return globalThis.localStorage || null; } catch { return null; } };
export function readMuted(s = store()) {
  try { return parseMuted(s ? s.getItem(MUTE_KEY) : null); } catch { return false; }
}
export function writeMuted(muted, s = store()) {
  try { s?.setItem(MUTE_KEY, formatMuted(muted)); } catch { /* not remembered; still applies for this visit */ }
}

// Everyone who plays or shows the setting listens here, so the gallery's button, the station's and the music agree.
const listeners = new Set();
let current = null;
export const isMuted = () => (current ??= readMuted());
export function setMuted(muted) {
  current = !!muted;
  writeMuted(current);
  for (const fn of [...listeners]) fn(current);
}
export function onMuted(fn) { listeners.add(fn); return () => listeners.delete(fn); }
