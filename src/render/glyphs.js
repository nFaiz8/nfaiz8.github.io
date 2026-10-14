// Cell metrics and glyph drawing shared by both renderers. Box-drawing and shade characters are
// drawn as shapes (like a terminal does) so lines join up across cells.

export const FONT_FAMILY = 'Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace';

const MIN_ROWS = 30; // so a short screen (a phone on its side) isn't a close-up of a few rows

export function cellMetrics(viewW, viewH) {
  const targetCols = viewW >= 900 ? 150 : 52;
  const cw = Math.max(6, Math.floor(Math.min(viewW / targetCols, viewH ? viewH / (2 * MIN_ROWS) : Infinity)));
  const ch = cw * 2;
  const fontPx = Math.floor(Math.min(ch * 0.8, cw / 0.6));
  return { cw, ch, fontPx, font: `${fontPx}px ${FONT_FAMILY}` };
}

// The side view (the arena) has its own cell size: rows visible, by the gun in hand (arena.js SIDE_ROWS).
// crisp: whole device pixels, so glyphs are as sharp as the gallery's (at least `rows` rows show); while
// the zoom eases, exactly `rows` rows and fractional cells (drawn scaled from the last atlas).
export function sideMetrics(viewH, dpr, rows, crisp = true) {
  const exact = viewH / rows / 2;
  const cw = crisp ? Math.max(2, Math.floor(exact * dpr)) / dpr : exact;
  const ch = cw * 2;
  const fontPx = Math.max(6, Math.floor(Math.min(ch * 0.8, cw / 0.6)));
  return { cw, ch, fontPx, font: `${fontPx}px ${FONT_FAMILY}`, crisp };
}

// arms: l r u d; '2' = double line
const BOX = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ur', '┘': 'ul', '├': 'udr', '┤': 'udl',
  '┬': 'lrd', '┴': 'lru', '┼': 'lrud', '═': 'lr2', '║': 'ud2', '╥': 'lrD', '╧': 'Ulr2',
  '╔': 'rd2', '╗': 'ld2', '╚': 'ur2', '╝': 'ul2',
};
const SHADE = { '█': 1, '▓': 0.72, '▒': 0.45, '░': 0.22 };
// The train's line glyphs (src/train.js): heavy lines, dashes, round corners, diagonals and half blocks,
// drawn as shapes so a window frame, a tube or a rail joins up across cells.
const HEAVY = { '━': 'lr', '┃': 'ud', '┷': 'lrU' };
const DASH = { '╌': 'h', '╎': 'v' };
const ROUND = { '╭': [1, 1], '╮': [-1, 1], '╰': [1, -1], '╯': [-1, -1] }; // the way its arms go: x, y
const HALF = { '▀': [0, 0, 1, 0.5], '▄': [0, 0.5, 1, 0.5], '▌': [0, 0, 0.5, 1], '▐': [0.5, 0, 0.5, 1] };
const DIAG = { '╱': 1, '╲': -1 };

export function isShape(c) {
  return c in BOX || c in SHADE || c in HEAVY || c in DASH || c in ROUND || c in HALF || c in DIAG;
}

// Draw one character into the cell at (x, y) with the current fillStyle.
export function drawGlyph(ctx, c, x, y, cw, ch, fontPx) {
  if (c === ' ') return;
  if (c in SHADE) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * SHADE[c];
    ctx.fillRect(x, y, cw, ch);
    ctx.globalAlpha = a;
    return;
  }
  if (c in HALF) {
    const [hx, hy, hw, hh] = HALF[c];
    ctx.fillRect(x + Math.round(hx * cw), y + Math.round(hy * ch), Math.round(hw * cw), Math.round(hh * ch));
    return;
  }
  const t = Math.max(1, Math.round(cw / 9));
  const mx = x + Math.floor((cw - t) / 2), my = y + Math.floor((ch - t) / 2);
  if (c in HEAVY) {
    const T = Math.max(2, t * 2), hx = x + Math.floor((cw - T) / 2), hy = y + Math.floor((ch - T) / 2);
    for (const a of HEAVY[c]) {
      if (a === 'l' || a === 'r') { ctx.fillRect(x, hy, cw, T); continue; }
      if (a === 'u' || a === 'd') { ctx.fillRect(hx, y, T, ch); continue; }
      if (a === 'U') ctx.fillRect(mx, y, t, hy - y);
    }
    return;
  }
  if (c in DASH) {
    if (DASH[c] === 'h') for (const k of [0, 1]) ctx.fillRect(x + Math.round((k * cw) / 2 + cw / 8), my, Math.round(cw / 4), t);
    else for (const k of [0, 1]) ctx.fillRect(mx, y + Math.round((k * ch) / 2 + ch / 8), t, Math.round(ch / 4));
    return;
  }
  if (c in ROUND) {
    // Two arms from the cell's middle out to its edges, the corner between them a quarter circle.
    const [ax, ay] = ROUND[c], r = Math.min(cw, ch) / 2, cx = mx + t / 2, cy = my + t / 2;
    ctx.save();
    ctx.lineWidth = t;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(ax > 0 ? x + cw : x, cy);
    ctx.arcTo(cx, cy, cx, ay > 0 ? y + ch : y, r);
    ctx.lineTo(cx, ay > 0 ? y + ch : y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (c in DIAG) {
    ctx.save();
    ctx.lineWidth = t;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(x, DIAG[c] > 0 ? y + ch : y);
    ctx.lineTo(x + cw, DIAG[c] > 0 ? y : y + ch);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const arms = BOX[c];
  if (arms) {
    const double = arms.endsWith('2');
    const line = (dir, dbl) => {
      const offs = dbl ? [-t * 1.5, t * 1.5] : [0];
      for (const o of offs) {
        if (dir === 'l') ctx.fillRect(x, my + o, mx - x + t, t);
        if (dir === 'r') ctx.fillRect(mx, my + o, x + cw - mx, t);
        if (dir === 'u') ctx.fillRect(mx + o, y, t, my - y + t);
        if (dir === 'd') ctx.fillRect(mx + o, my, t, y + ch - my);
      }
    };
    for (const a of arms.replace('2', '')) {
      if (a === 'D') line('d', true);
      else if (a === 'U') line('u', false);
      else line(a, double);
    }
    return;
  }
  ctx.fillText(c, x + cw / 2, y + ch / 2 + fontPx * 0.05);
}

export function prepareText(ctx, font) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
}

export const rgb = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;
