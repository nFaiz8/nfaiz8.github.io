// Photo pixels → character cells. Pure, shared by both renderers and the tests.

export const RAMP = ' .:-=+*#%@';

const lumOf = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

// Luminance range between the 2nd and 98th percentiles, so dark scans still use the whole ramp.
export function stretchRange(data) {
  const hist = new Uint32Array(256);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    hist[Math.min(255, Math.round(lumOf(data[i], data[i + 1], data[i + 2]) * 255))]++;
    n++;
  }
  const pick = (q) => {
    let acc = 0;
    for (let v = 0; v < 256; v++) if ((acc += hist[v]) >= q * n) return v / 255;
    return 1;
  };
  const lo = pick(0.02);
  const hi = Math.max(pick(0.98), lo + 1 / 255);
  return { lo, hi };
}

export const stretch = (lum, { lo, hi }) => Math.min(1, Math.max(0, (lum - lo) / (hi - lo)));
export const glyphIndex = (lum) => Math.min(RAMP.length - 1, Math.floor(lum * RAMP.length));

function saturate(r, g, b, amt) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const s = (c) => Math.max(0, Math.min(255, Math.round(l + (c - l) * amt)));
  return [s(r), s(g), s(b)];
}

// image: { data, width, height } (ImageData-like). Returns per-cell glyph index, lum, fg and bg colours.
export function toCells(image, cols, rows, { mono = false, range = null } = {}) {
  const { data, width, height } = image;
  const rng = range || stretchRange(data);
  const n = cols * rows;
  const out = { cols, rows, glyph: new Uint8Array(n), lum: new Float32Array(n), fg: new Uint8Array(n * 3), bg: new Uint8Array(n * 3) };
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * height) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * height) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * width) / cols));
      let r = 0, g = 0, b = 0, c = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const i = (y * width + x) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; c++;
        }
      }
      r /= c; g /= c; b /= c;
      const k = cy * cols + cx;
      const lum = stretch(lumOf(r, g, b), rng);
      out.lum[k] = lum;
      out.glyph[k] = glyphIndex(lum);
      let fg;
      if (mono) fg = [Math.round(90 + 165 * lum), Math.round(20 * lum), Math.round(16 * lum)];
      else fg = saturate(r, g, b, 1.25);
      // Keep characters visible: lift very dark foregrounds a little.
      const lift = Math.max(0, 70 - Math.max(...fg));
      fg = fg.map((v) => Math.min(255, v + lift));
      out.fg.set(fg, k * 3);
      out.bg.set(mono ? [Math.round(46 * lum + 8), 0, 0] : [r * 0.42, g * 0.42, b * 0.42].map(Math.round), k * 3);
    }
  }
  return out;
}

// Darkroom develop. exposure 0→1 reveals shadows first; colorMix 0→1 goes from red mono to true colour.
// Returns { blank, glyph, fg: [r,g,b] } for one cell.
export function developCell(lum, rgb, exposure, colorMix) {
  if (lum > exposure) return { blank: true, glyph: '░', fg: [70, 22, 18] };
  const red = [Math.round(90 + 165 * lum), Math.round(20 * lum), Math.round(16 * lum)];
  const fg = red.map((v, i) => Math.round(v + (rgb[i] - v) * colorMix));
  return { blank: false, glyph: RAMP[glyphIndex(lum)], fg };
}
