// Which museum track plays (station spec §8): the site's own jazz, or noir jazz to compare, chosen by ?track=1…4 in
// the URL (1, the default, when it's
// missing or anything else). Kept apart from music.js, and free of the mp3s themselves, so the map's credit and the
// sound button's tooltip can name the track on the gallery's first load without pulling in the music.
//
// loopStart/loopEnd are seconds into each file: its start plays once, then [loopStart, loopEnd) repeats. Each seam is
// crossfaded into the file (the 0.3 s before loopEnd fade into the 0.3 s before loopStart), see CREDITS.md.
const BY = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/' };
export const TRACKS = [
  // The site's own track (no credit needed). 16½ minutes, so it streams (music.js) rather than loading whole, and
  // loops back to its start at the end.
  { file: 'tuffjazz', own: true, stream: true },
  // 90 bpm: plays its intro once, then 48 bars (128 s) whose end comes round to the same phrase as their start.
  { file: 'signs-to-nowhere', title: 'Signs To Nowhere', artist: 'Shane Ivers', site: 'silvermansound.com', siteUrl: 'https://www.silvermansound.com', licence: BY, loopStart: 23.3217, loopEnd: 151.3215 },
  // 110 bpm: the head comes back 84 bars (183 s) after its 9th bar, so the loop runs from there to there.
  { file: 'spy-glass', title: 'Spy Glass', artist: 'Kevin MacLeod', site: 'incompetech.com', siteUrl: 'https://incompetech.com', licence: BY, loopStart: 19.6009, loopEnd: 202.8778 },
  // ~68 bpm, played freely: nearly the whole piece loops, from 5.5 s to where the bass comes round to it again.
  { file: 'covert-affair', title: 'Covert Affair', artist: 'Kevin MacLeod', site: 'incompetech.com', siteUrl: 'https://incompetech.com', licence: BY, loopStart: 5.5, loopEnd: 178.4416 },
];

// The chosen track's index (0-based) from a query string such as location.search.
export function trackIndex(search = globalThis.location?.search || '') {
  let n = NaN;
  try { n = Number(new URLSearchParams(search).get('track')); } catch { /* no URL, the default */ }
  return Number.isInteger(n) && n >= 1 && n <= TRACKS.length ? n - 1 : 0;
}
export const chosenTrack = (search) => TRACKS[trackIndex(search)];

// The credit CC BY asks for, as plain text (the tooltip) and as HTML with links (under the map).
export const creditText = (t = chosenTrack()) => t.own ? '' : `music: “${t.title}” ${t.artist} (${t.site}), ${t.licence.name}`;
export const creditHTML = (t = chosenTrack()) => t.own ? '' :
  `music: “${t.title}” ${t.artist} (<a href="${t.siteUrl}" target="_blank" rel="noopener">${t.site}</a>), licensed under <a href="${t.licence.url}" target="_blank" rel="noopener">${t.licence.name}</a>`;
