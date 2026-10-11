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

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SRC = path.join(root, 'photos');
const OUT = path.join(root, 'public/photos');
const force = process.argv.includes('--force');
const SIZES = [['low', 512, 72], ['hi', 2560, 84], ['xl', 4096, 86]];
const IMAGE = /\.(jpe?g|png|webp|tiff?|heic|heif|avif)$/i;

fs.mkdirSync(SRC, { recursive: true });
for (const [dir] of SIZES) fs.mkdirSync(path.join(OUT, dir), { recursive: true });

let previous = {};
try { for (const p of JSON.parse(fs.readFileSync(path.join(OUT, 'photos.json'), 'utf8')).photos) previous[p.id] = p; } catch {}

// "Holiday 2024/DSCF7438.JPG" → "holiday-2024-dscf7438"; ids stay unique and URL-safe.
const idOf = (rel) => rel.replace(IMAGE, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

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

async function details(file) {
  let x = {};
  try {
    x = (await exifr.parse(file, { gps: false, xmp: false, iptc: false, icc: false,
      pick: ['Make', 'Model', 'LensModel', 'FocalLength', 'FNumber', 'ExposureTime', 'ISO', 'DateTimeOriginal', 'CreateDate'] })) || {};
  } catch {}
  const date = x.DateTimeOriginal || x.CreateDate;
  const d = date instanceof Date && !isNaN(date) ? date : null;
  return {
    camera: cameraName(x.Make, x.Model),
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
    const info = await details(file);
    photos.push({
      id, hash, category: 'digital', ...info, width, height, aspect: Math.round((width / height) * 1000) / 1000,
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

photos.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || a.id.localeCompare(b.id));
fs.writeFileSync(path.join(OUT, 'photos.json'), JSON.stringify({ generated: new Date().toISOString(), photos }, null, 1));
const bw = photos.filter((p) => p.analysis && p.analysis.score < 0.12).length;
console.log(`\rphotos: ${photos.length} ready (${made} new or changed, ${kept} unchanged${failed ? `, ${failed} skipped` : ''}); ${bw} black & white`);
if (!photos.length) console.log('photos: photos/ is empty; add images there and run again');
