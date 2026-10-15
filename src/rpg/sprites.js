// ASCII art standing up in the 3D station (station spec §5): each sprite is a canvas texture on an upright
// plane, its origin at the feet, sized in world units so it scales with distance like everything else.
import * as THREE from 'three';

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, monospace';
const PX = 64; // the font's pixel size on a sprite's canvas

export function makeSprite(lines, colors, height, { glow = false } = {}) {
  const canvas = document.createElement('canvas');
  const cols = Math.max(...lines.map((l) => [...l].length));
  const cw = Math.ceil(PX * 0.62), lh = Math.ceil(PX * 1.08);
  canvas.width = cols * cw + 16;
  canvas.height = lines.length * lh + 16;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  // Glowing sprites (you) skip tone mapping, so they stay the brightest, crispest thing on screen.
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.05, depthWrite: false, side: THREE.DoubleSide, toneMapped: !glow });
  const geo = new THREE.PlaneGeometry((height * canvas.width) / canvas.height, height);
  geo.translate(0, height / 2, 0);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  const draw = (ls) => {
    const c = canvas.getContext('2d');
    c.clearRect(0, 0, canvas.width, canvas.height);
    c.font = `700 ${PX}px ${FONT}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.lineJoin = 'round';
    ls.forEach((line, i) => {
      const y = 8 + lh * (i + 0.5);
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 10;
      c.strokeText(line, canvas.width / 2, y);
      c.fillStyle = Array.isArray(colors) ? colors[i] ?? colors[0] : colors;
      c.fillText(line, canvas.width / 2, y);
    });
    tex.needsUpdate = true;
  };
  draw(lines);
  return { mesh, draw, dispose() { geo.dispose(); mat.dispose(); tex.dispose(); } };
}

// You: 4 lines with a lantern, two walking frames (the legs swap).
export const PLAYER = [
  [' o ', '/|\\¤', ' | ', '/ \\'],
  [' o ', '/|\\¤', ' | ', ' |\\'],
];
export const PLAYER_COLORS = ['#ffe6bd', '#ffce6e', '#e9a23b', '#c98a3a'];

export const PROPS = {
  bin: { lines: [' ___ ', '|###|', '|___|'], colors: ['#a7afc2', '#6f7890', '#6f7890'], h: 0.9 },
  board: { lines: ['┌──────┐', '│ ═╪═╪ │', '│ ═╪══ │', '└──┬┬──┘', '   ││   '], colors: ['#c9d2e6', '#7fc4ff', '#ff9a7a', '#c9d2e6', '#8a93a8'], h: 1.9 },
  vending: { lines: ['┌────┐', '│▒▒▒▒│', '│▒▒▒▒│', '│ ══ │', '└────┘'], colors: ['#d9dee9', '#ff7a7a', '#7affc4', '#d9dee9', '#d9dee9'], h: 2.0 },
  news: { lines: ['▤'], colors: ['#d8d2c4'], h: 0.35 },
};
