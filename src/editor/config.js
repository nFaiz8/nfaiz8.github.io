// Where the editor reads and writes. The API base can be pointed elsewhere only in the dev server
// (for the browser checks); in the built site it is always GitHub.
export const OWNER = 'nFaiz8';
export const REPO = 'nfaiz8.github.io';
export const BRANCH = 'main';
function devApi() {
  try { return import.meta.env.DEV ? new URLSearchParams(location.search).get('api') : null; } catch { return null; } // Node: no import.meta.env
}
export const API = devApi() || 'https://api.github.com';

export const PHOTOS_DIR = 'photos/';
export const EDITS_PATH = 'photos/edits.json';

// HEIC is left out on purpose: iOS then hands the page a JPEG, which the build can always read.
export const UPLOADABLE = /\.(jpe?g|png|webp)$/i;
export const WARN_BYTES = 25 * 1024 * 1024;
export const MAX_BYTES = 100 * 1024 * 1024;

// Relative to /edit/. raw.json has the files' own details (for placeholders); photos.json shows when a build is live.
export const MANIFEST = '../photos/raw.json';
export const LIVE_MANIFEST = '../photos/photos.json';
