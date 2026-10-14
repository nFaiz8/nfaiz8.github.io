// Loads the 512px "low" images and turns them into character cells. Cached per photo and size.
import { toCells, stretchRange } from './ascii.js';
import { coverCrop } from './arena.js';

const images = new Map(); // id → Promise<ImageBitmap>
const failed = new Set();
const cells = new Map(); // `${id}:${cols}x${rows}:${mono}` → cells
const ranges = new Map(); // id → {lo, hi}
let active = 0;
const queue = [];

function pump() {
  while (active < 6 && queue.length) {
    const job = queue.shift();
    active++;
    job().finally(() => { active--; pump(); });
  }
}

export function loadImage(photo, size = 'low') {
  const key = `${photo.id}:${size}`;
  if (!images.has(key)) {
    images.set(key, new Promise((resolve, reject) => {
      queue.push(async () => {
        try {
          const res = await fetch(photo.src[size]);
          if (!res.ok) throw new Error(`${photo.src[size]}: HTTP ${res.status}`);
          resolve(await createImageBitmap(await res.blob()));
        } catch (e) {
          failed.add(photo.id);
          reject(e);
        }
      });
      pump();
    }));
  }
  return images.get(key);
}

export const hasFailed = (id) => failed.has(id);

function pixels(bitmap, w, h, crop = null) {
  const c = new OffscreenCanvas(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true });
  if (crop) ctx.drawImage(bitmap, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, w, h);
  else ctx.drawImage(bitmap, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

export function rangeOf(photo, bitmap) {
  if (!ranges.has(photo.id)) ranges.set(photo.id, stretchRange(pixels(bitmap, 64, 64).data));
  return ranges.get(photo.id);
}

// Synchronous lookup; returns null until the image has loaded. cover: crop the middle of the image to the
// cells' shape instead of stretching it (the arena backdrop).
export function cellsFor(photo, cols, rows, mono, bitmap, cover = false) {
  const key = `${photo.id}:${cols}x${rows}:${mono ? 1 : 0}${cover ? ':cover' : ''}`;
  let c = cells.get(key);
  if (!c && bitmap) {
    const crop = cover ? coverCrop(bitmap.width, bitmap.height, cols, rows) : null;
    const img = pixels(bitmap, Math.round(Math.min(crop ? crop.sw : bitmap.width, cols * 4)), Math.round(Math.min(crop ? crop.sh : bitmap.height, rows * 8)), crop);
    c = toCells(img, cols, rows, { mono, range: rangeOf(photo, bitmap) });
    cells.set(key, c);
  }
  return c || null;
}
