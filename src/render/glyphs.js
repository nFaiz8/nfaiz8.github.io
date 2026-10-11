// Cell metrics and glyph drawing shared by both renderers. Box-drawing and shade characters are
// drawn as shapes (like a terminal does) so lines join up across cells.

export const FONT_FAMILY = 'Menlo, "SF Mono", Consolas, "DejaVu Sans Mono", monospace';

export function cellMetrics(viewW) {
  const targetCols = viewW >= 900 ? 150 : 52;
  const cw = Math.max(6, Math.floor(viewW / targetCols));
  const ch = cw * 2;
  const fontPx = Math.floor(Math.min(ch * 0.8, cw / 0.6));
  return { cw, ch, fontPx, font: `${fontPx}px ${FONT_FAMILY}` };
}

// arms: l r u d; '2' = double line
const BOX = {
  '─': 'lr', '│': 'ud', '┌': 'rd', '┐': 'ld', '└': 'ur', '┘': 'ul', '├': 'udr', '┤': 'udl',
  '┬': 'lrd', '┴': 'lru', '┼': 'lrud', '═': 'lr2', '║': 'ud2', '╥': 'lrD', '╧': 'Ulr2',
  '╔': 'rd2', '╗': 'ld2', '╚': 'ur2', '╝': 'ul2',
};
const SHADE = { '█': 1, '▓': 0.72, '▒': 0.45, '░': 0.22 };

export function isShape(c) {
  return c in BOX || c in SHADE;
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
  const arms = BOX[c];
  if (arms) {
    const t = Math.max(1, Math.round(cw / 9));
    const mx = x + Math.floor((cw - t) / 2), my = y + Math.floor((ch - t) / 2);
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
