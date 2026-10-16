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

// Options: glow (skips tone mapping and writes no depth: a sign over walkable floor), bright (a colour multiplier,
// over 1 so a lit sign blooms), bg (a panel colour filled behind the glyphs), ink(ch, line, col) (a glyph's own
// colour, or null for its line's; bg may be a function (ctx, w, h, pad) that paints its own), depth (false: never hides what's behind it).
// gap: extra space between lines, as a share of a line (box-drawing strokes then no longer meet across lines);
// frame: a colour to outline the panel with instead.
export function makeSprite(lines, colors, height, { glow = false, centre = null, bright = 1, bg = null, ink = null, depth = !glow, gap = 0, frame = null } = {}) {
  const canvas = document.createElement('canvas');
  const { cw, ascent, lh: line } = grid();
  const lh = Math.round(line * (1 + gap));
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
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: depth, side: THREE.DoubleSide, toneMapped: !glow });
  if (bright !== 1) mat.color.setScalar(bright);
  const geo = new THREE.PlaneGeometry((height * canvas.width) / canvas.height, height);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const lineColor = (i) => (Array.isArray(colors) ? colors[i] ?? colors[0] : colors);
  const draw = (ls) => {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    if (typeof bg === 'function') bg(c, canvas.width, canvas.height, PAD);
    else if (bg) { c.fillStyle = bg; c.fillRect(PAD / 2, PAD / 2, canvas.width - PAD, canvas.height - PAD); }
    if (frame) { c.strokeStyle = frame; c.lineWidth = 5; c.strokeRect(PAD / 2 + 2.5, PAD / 2 + 2.5, canvas.width - PAD - 5, canvas.height - PAD - 5); }
    c.font = `700 ${PX}px ${FONT}`;
    c.textAlign = 'left';
    c.textBaseline = 'alphabetic';
    // No dark outline: per glyph, it showed through as notches wherever two strokes meet.
    for (let i = 0; i < ls.length; i++) {
      const chars = [...ls[i]];
      for (let j = 0; j < chars.length; j++) {
        const ch = chars[j];
        if (ch === ' ') continue;
        c.fillStyle = (ink && ink(ch, i, j)) ?? GLYPH_COLORS[ch] ?? lineColor(i);
        c.fillText(ch, x0 + j * cw, PAD + lh * i + ascent + (lh - line) / 2);
      }
    }
    tex.needsUpdate = true;
  };
  draw(lines);
  return { mesh, draw, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}


// A box of text: `rows` padded to `w` inside │ │, with a title set into the top edge.
export function boxed(rows, w, title = '') {
  const top = title ? `┌─ ${title} ${'─'.repeat(Math.max(0, w - title.length - 3))}┐` : `┌${'─'.repeat(w)}┐`;
  return [top, ...rows.map((r) => `│${r.padEnd(w).slice(0, w)}│`), `└${'─'.repeat(w)}┘`];
}

// The line map: the site's rooms as stops on one line, you at the museum end.
const STOPS = ['MUSEUM', 'ARCADE', 'DARKROOM', 'GORGE'];
const MAP_W = 31;
const lineMap = (() => {
  const labels = 'MUSEUM  ARCADE  DARKROOM  GORGE';
  const at = STOPS.map((s) => labels.indexOf(s) + Math.floor((s.length - 1) / 2)); // each stop over its name
  const track = [...' '.repeat(MAP_W)];
  for (let i = at[0]; i <= at.at(-1); i++) track[i] = '━';
  for (const i of at) track[i] = '●';
  return boxed(['', track.join(''), labels, '  ▲ YOU ARE HERE'], MAP_W, 'MUSEUM LINE');
})();

const CAN = ['#ff6a5c', '#5fd38a', '#6aa8ff'];
export const PROPS = {
  bin: { lines: [' _____ ', '│TRASH│', '│     │', '│_____│'], colors: ['#a7afc2', '#c9d0de', '#6f7890', '#6f7890'], h: 0.95,
    opts: { bg: (c, w, h, pad) => { c.fillStyle = '#262b36'; c.fillRect(pad * 1.2, h * 0.22, w - pad * 2.4, h * 0.78 - pad); } } },
  map: {
    lines: lineMap, colors: ['#d9e2f2', '#d9e2f2', '#e2483d', '#e9eef8', '#ffce6e', '#d9e2f2'], h: 1.12,
    opts: { bg: '#121a2c', ink: (ch, i) => (ch === '●' ? '#ffffff' : ch === '▲' ? '#ffce6e' : null) },
  },
  vending: {
    lines: ['┌────────┐', '│ DRINKS │', '│ ▮ ▮ ▮ ▮│', '│ ────── │', '│ ▮ ▮ ▮ ▮│', '│ ────── │', '│ $1.50 ▯│', '│ ▀▀▀▀▀  │', '└────────┘'],
    colors: ['#e6eaf2', '#fff2c0', '#e6eaf2', '#8a6a6e', '#e6eaf2', '#8a6a6e', '#9fffb0', '#2a2e38', '#e6eaf2'], h: 2.0,
    opts: { bg: '#5b1a1f', ink: (ch, i, j) => (ch === '▮' ? CAN[((j - 2) / 2 + i) % 3] : ch === '▯' ? '#ffd27a' : null) },
  },
  closed: { lines: boxed([' CLOSED '], 8), colors: ['#c9c2b4', '#ff5a4a', '#c9c2b4'], h: 0.42, opts: { bg: '#1c1513' } },
  nowShowing: {
    lines: ['┌────────────┐', '│ faiz.pics  │', '│╔══════════╗│', '│║  /\\   ·  ║│', '│║ /  \\/\\   ║│', '│║/      \\  ║│', '│╚══════════╝│', '│NOW SHOWING │', '└────────────┘'],
    colors: ['#2b2a28', '#1d1b18', '#2b2a28', '#3f6d8a', '#3f6d8a', '#3f6d8a', '#2b2a28', '#b8322a', '#2b2a28'], h: 1.75,
    opts: { bg: '#e8dfc8', ink: (ch, i) => (ch === '·' ? '#d89a2a' : '║╔╗╚╝═'.includes(ch) ? '#2b2a28' : null) },
  },
  gap: { lines: boxed([' MIND THE GAP ', ' ▀▀▀▀▀▀▀▀▀▀▀▀ '], 14), colors: ['#1a1a1a', '#121212', '#121212', '#1a1a1a'], h: 0.75, opts: { bg: '#f2c230' } },
  // The torn poster: its top-right corner gone (scene.js hangs the flap that's left of it, and flaps it in a train's wind).
  torn: {
    lines: ['┌─────────╲  ', '│ LIVE AT  ╲ ', '│ THE GORGE │', '│ FRI · 9PM │', '└───────────┘'],
    colors: ['#3a1e40', '#3a1e40', '#7a2a6a', '#3a1e40', '#3a1e40'], h: 0.95,
    opts: { bg: (c, w, h, pad) => { c.fillStyle = '#d7c2df'; c.beginPath(); c.moveTo(pad / 2, pad / 2); c.lineTo(w * 0.78, pad / 2); c.lineTo(w - pad / 2, h * 0.5); c.lineTo(w - pad / 2, h - pad / 2); c.lineTo(pad / 2, h - pad / 2); c.closePath(); c.fill(); } },
  },
  flap: { lines: ['▙'], colors: ['#d7c2df'], h: 0.3 },
  // A pigeon side on, facing right (scene.js mirrors it), in quarter blocks: head and beak, body, tail and feet.
  pigeon: {
    frames: { stand: ['   ▗█▖', '▟████ ', '▝▜▀▛▘ '], peck: ['      ', '▟███▄ ', '▝▜▀▛▘█'], up: [' ▚  ▞ ', ' ▝██▙▖', '      '], down: ['      ', '▗▄██▙▖', '▘   ▝ '] },
    colors: ['#5f7a78', '#a3acc0', '#6c7384'], h: 0.36,
    opts: { ink: (ch, i, j) => (i === 0 && j === 5 ? '#d9b36a' : i === 2 && ch === '█' ? '#5f7a78' : null) },
  },
  rat: { frames: { a: ['~▄██▙▖'], b: ['⌒▄██▙▖'] }, colors: ['#a89a88'], h: 0.16 }, // tail, body, head, facing right
  news: { lines: ['▤'], colors: ['#d8d2c4'], h: 0.35 },
};
