// ASCII art standing up in the 3D station (station spec §5): each sprite is a canvas texture on an upright
// plane, its origin at the feet, sized in world units so it scales with distance like everything else.
import * as THREE from 'three';

export const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const PX = 64; // the font's pixel size on a sprite's canvas

// Every sprite is drawn on one fixed character grid: each glyph left-aligned in its own cell, cells a font advance
// wide, and lines exactly one '│' tall, so box-drawing strokes meet across lines. `centre` is the column the
// mesh's origin sits on; by default the middle of the widest line.
const grid = (() => {
  let g = null;
  return () => {
    if (g) return g;
    const c = document.createElement('canvas').getContext('2d');
    c.font = `700 ${PX}px ${FONT}`;
    const bar = c.measureText('│');
    g = { cw: c.measureText('M').width, ascent: bar.actualBoundingBoxAscent, lh: Math.floor(bar.actualBoundingBoxAscent + bar.actualBoundingBoxDescent) - 1 };
    return g;
  };
})();
const PAD = 8;
const GLYPH_COLORS = { '¤': '#ffce6e' }; // the lantern keeps its own warm gold whatever line it's on

export function makeSprite(lines, colors, height, { glow = false, centre = null } = {}) {
  const canvas = document.createElement('canvas');
  const { cw, ascent, lh } = grid();
  const cols = Math.max(...lines.map((l) => [...l].length));
  const mid = centre == null ? cols / 2 : centre + 0.5; // in columns from the left edge
  const half = Math.max(mid, cols - mid);
  const x0 = PAD + (half - mid) * cw; // the left edge of column 0
  canvas.width = Math.ceil(2 * half * cw) + 2 * PAD;
  canvas.height = lines.length * lh + 2 * PAD;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Glowing sprites (the way-out sign) skip tone mapping, so they stay the brightest, crispest thing on screen.
  // A prop writes depth where it has ink (alphaTest drops the rest), so you go behind one that's in front. A glowing
  // sign hangs over walkable floor, so it doesn't, and never hides you.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: !glow, side: THREE.DoubleSide, toneMapped: !glow });
  const geo = new THREE.PlaneGeometry((height * canvas.width) / canvas.height, height);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const lineColor = (i) => (Array.isArray(colors) ? colors[i] ?? colors[0] : colors);
  const draw = (ls) => {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.font = `700 ${PX}px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    const cells = ls.flatMap((line, i) => [...line].map((ch, j) => ({ ch, i, x: x0 + j * cw, y: PAD + lh * i + ascent }))).filter((g) => g.ch !== ' ');
    // No dark outline: per glyph, it showed through as notches wherever two strokes meet.
    for (const g of cells) { c.fillStyle = GLYPH_COLORS[g.ch] ?? lineColor(g.i); c.fillText(g.ch, g.x, g.y); }
    tex.needsUpdate = true;
  };
  draw(lines);
  return { mesh, draw, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

export const PROPS = {
  bin: { lines: [' ___ ', '|###|', '|___|'], colors: ['#a7afc2', '#6f7890', '#6f7890'], h: 0.9 },
  board: { lines: ['┌──────┐', '│ ═╪═╪ │', '│ ═╪══ │', '└──┬┬──┘', '   ││   '], colors: ['#c9d2e6', '#7fc4ff', '#ff9a7a', '#c9d2e6', '#8a93a8'], h: 1.9 },
  vending: { lines: ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│ ══ │', '└────┘'], colors: ['#d9dee9', '#ff7a7a', '#7affc4', '#d9dee9', '#d9dee9'], h: 2.0 },
  news: { lines: ['▤'], colors: ['#d8d2c4'], h: 0.35 },
};
