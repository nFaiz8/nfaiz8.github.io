// Turn the originals in photos/ into what the gallery serves, in public/photos/:
//   low/<id>.webp  512px   (ASCII art and room sorting)
//   hi/<id>.webp   2560px  (the viewer)
//   xl/<id>.webp   4096px  (zooming in; only when the original is that big)
//   photos.json    camera details and measured colour for every photo
// Published copies carry no metadata (no GPS). Photos have no titles. Unchanged photos are skipped.
// Usage: npm run photos   (add --force to redo everything)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import exifr from 'exifr';
import { analyzePixels } from '../src/analyze.js';
import { IMAGE, idOf, parseEdits, applyEdits } from '../src/edits.js';
import { filmInfo } from '../src/film.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = path.join(root, 'photos');
const OUT = path.join(root, 'public/photos');
const force = process.argv.includes('--force');
const SIZES = [['low', 512, 72], ['hi', 2560, 84], ['xl', 4096, 86]];

fs.mkdirSync(SRC, { recursive: true });
for (const [dir] of SIZES) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

// The cache is the un-edited manifest, so removing an edit really removes it.
// (Builds from before raw.json existed fall back to photos.json, which had no edits then.)
let previous = {};
for (const name of ['raw.json', 'photos.json']) {
  try {
    for (const p of JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8')).photos) previous[p.id] = p;
    break;
  } catch {}
}

function walk(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('.')) return [];
    const rel = path.join(base, e.name);
    if (e.isDirectory()) return walk(path.join(dir, e.name), rel);
    return IMAGE.test(e.name) ? [rel] : [];
  });
}

const titleCase = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());
function cameraName(make, model) {
  if (!model) return make ? titleCase(make.trim()) : null;
  model = model.trim();
  if (!make) return model;
  const m = make.trim().split(/\s+/)[0];
  return model.toLowerCase().startsWith(m.toLowerCase()) ? model : `${titleCase(m)} ${model}`;
}
function shutter(t) {
  if (!t) return null;
  if (t >= 1) return `${Math.round(t * 10) / 10}s`;
  return `1/${Math.round(1 / t)}s`;
}

async function details(file, rel) {
  let x = {};
  try {
    x = (await exifr.parse(file, { gps: false, xmp: false, iptc: false, icc: false,
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'CreateDate'] })) || {};
  } catch {}
  const date = x.DateTimeOriginal || x.CreateDate;
  const d = date instanceof Date && !isNaN(date) ? date : null;
  return {
    ...(() => {
      const f = filmInfo(rel, x.Make, x.Model);
      // A scanner isn't a camera; film shows as film.
      return f.film ? { category: 'film', camera: null, scanner: f.scanner } : { category: 'digital', camera: cameraName(x.Make, x.Model) };
    })(),
    lens: x.LensModel ? String(x.LensModel).trim() : null,
    focalLength: x.FocalLength ? `${Math.round(x.FocalLength)}mm` : null,
    aperture: x.FNumber ? String(Math.round(x.FNumber * 10) / 10) : null,
    shutter: shutter(x.ExposureTime),
    iso: x.ISO || null,
    date: d ? d.toISOString().slice(0, 10) : null,
    year: d ? d.getFullYear() : null,
  };
}

const files = walk(SRC).sort();
const seen = new Set();
const photos = [];
let made = 0, kept = 0, failed = 0;
for (const rel of files) {
  const file = path.join(SRC, rel);
  let id = idOf(rel);
  while (seen.has(id)) id += '-2';
  seen.add(id);
  const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex').slice(0, 12);
  const out = (dir) => path.join(OUT, dir, `${id}.webp`);
  const prev = previous[id];
  if (!force && prev && prev.hash === hash && fs.existsSync(out('low')) && fs.existsSync(out('hi'))) {
    photos.push(prev);
    kept++;
    continue;
  }
  try {
    const img = sharp(file, { failOn: 'none' }).rotate(); // apply camera orientation
    const meta = await img.metadata();
    const swap = (meta.orientation || 1) >= 5;
    const width = swap ? meta.height : meta.width, height = swap ? meta.width : meta.height;
    const src = {};
    for (const [dir, size, quality] of SIZES) {
      if (dir === 'xl' && Math.max(width, height) <= 2560) { fs.rmSync(out('xl'), { force: true }); continue; }
      await sharp(file, { failOn: 'none' }).rotate()
        .resize({ width: size, height: size, fit: 'inside', withoutEnlargement: true })
        .webp({ quality })
        .toFile(out(dir));
      src[dir] = `photos/${dir}/${id}.webp`;
    }
    const { data } = await sharp(out('low')).resize({ width: 160 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const analysis = analyzePixels(data);
    const info = await details(file, rel);
    photos.push({
      id, hash, ...info, width, height, aspect: Math.round((width / height) * 1000) / 1000,
      analysis, palette: [], title: null, hidden: false, variants: [], src,
    });
    made++;
    if (process.stdout.isTTY) process.stdout.write(`\rphotos: ${made + kept}/${files.length}`);
  } catch (e) {
    failed++;
    console.warn(`\nphotos: skipped ${rel} (${e.message})`);
  }
}

// Remove published copies of photos that were deleted from photos/.
for (const [dir] of SIZES) {
  for (const f of fs.readdirSync(path.join(OUT, dir))) if (!seen.has(f.replace(/\.webp$/, ''))) fs.rmSync(path.join(OUT, dir, f));
}

// photos/edits.json (written by the /edit/ page) overrides film, stock, hidden, date, camera, lens and place.
let edits = {};
const editsFile = path.join(SRC, 'edits.json');
if (fs.existsSync(editsFile)) {
  try {
    edits = parseEdits(fs.readFileSync(editsFile, 'utf8'));
  } catch (e) {
    console.error(`photos: photos/edits.json is not valid (${e.message})`);
    process.exit(1);
  }
}
const generated = new Date().toISOString();
fs.writeFileSync(path.join(OUT, 'raw.json'), JSON.stringify({ generated, photos }, null, 1));
const { photos: edited, unmatched } = applyEdits(photos, edits);
for (const id of unmatched) console.warn(`photos: edits.json has an entry for "${id}" but no such photo`);
edited.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify({ generated, photos: edited }, null, 1));
const bw = edited.filter((p) => p.analysis && p.analysis.score < 0.12).length;
console.log(`\rphotos: ${edited.length} ready (${made} new or changed, ${kept} unchanged${failed ? `, ${failed} skipped` : ''}); ${bw} black & white`);
if (!edited.length) console.log('photos: photos/ is empty; add images there and run again');
