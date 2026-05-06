import sharp from 'sharp';
import { readdirSync, mkdirSync, existsSync } from 'fs';
import { join, extname, basename, dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const IMAGES_DIR = resolve(__dirname, '../public/images');
const THUMBS_DIR = resolve(__dirname, '../public/images/thumbs');
const MAX_SIZE = 800;
const VALID_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp']);

mkdirSync(THUMBS_DIR, { recursive: true });

const files = readdirSync(IMAGES_DIR)
  .filter(f => VALID_EXT.has(extname(f).toLowerCase()));

let generated = 0;
let skipped = 0;

await Promise.all(files.map(async filename => {
  const base = basename(filename, extname(filename));
  const outPath = join(THUMBS_DIR, `${base}.jpg`);

  if (existsSync(outPath)) {
    skipped++;
    return;
  }

  try {
    await sharp(join(IMAGES_DIR, filename))
      .rotate()
      .resize(MAX_SIZE, MAX_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outPath);
    generated++;
    console.log(`  ✓ ${filename}`);
  } catch (err) {
    console.warn(`  WARN: ${filename} — ${err.message}`);
  }
}));

console.log(`\nDone: ${generated} generated, ${skipped} already existed.`);
