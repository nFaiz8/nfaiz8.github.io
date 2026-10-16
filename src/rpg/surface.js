// The station's surfaces as dense ASCII (experiment): every lit box is painted with a tight grid of monospace glyphs,
// DENSITY cells per world unit, and mapped by world position (box mapping), so a glyph is the same size on every face
// whatever the box's scale, and neighbouring boxes run on without a seam. Lit signs, sprites and figures are not
// touched; this is only the matte walls, floors, track bed, stairs, pillars, benches, kiosk and turnstile steel.
import * as THREE from 'three';
import { FONT } from './sprites.js';

// Glyph cells per world unit, across × up: the one knob. 6×4 reads as text at 1440×900; 8×5 starts to read as
// speckle, and 10×6 as grey grain.
export const DENSITY = { cols: 6, rows: 4 };
const PX = 256; // canvas pixels per world unit, so glyphs stay crisp close up and mipmap down cleanly far away

// A small seeded generator, so the speckle is the same on every load.
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e6) / 1e6; };
}
const pick = (r, table) => { let x = r(); for (const [g, p] of table) { if ((x -= p) < 0) return g; } return table[table.length - 1][0]; };

// Each surface: base colour, ink, ink alpha, how many world units one texture spans (more for the seeded ones, so
// they don't repeat every unit), and the glyph for cell (c, r) of a unit (C × R cells), counted from the top-left.
// A floor cell: a + at each tile's corner, otherwise a · lattice with a seeded . : , ' sprinkle.
const FLOOR = [['·', 0.58], ['.', 0.12], [':', 0.1], [',', 0.05], ["'", 0.05], [' ', 0.1]];
const floor = (c, r, rand) => (c === 0 && r === 0 ? '+' : pick(rand, FLOOR));
const half = (n) => Math.max(2, Math.round(n / 2));
export const SURFACES = {
  // Tiled walls: a ┼─ grid of half-unit tiles, a faint · in each tile.
  wall: { base: '#3a3f4f', ink: '#8d96ad', alpha: 0.5, span: 1, glyph: (c, r, C, R) => {
    const jc = c % half(C) === 0, jr = r % half(R) === 0;
    return jc && jr ? '┼' : jr ? '─' : jc ? '│' : ['·', 0.45];
  } },
  // Floors: + tile corners in a · lattice, with a seeded sprinkle.
  hall: { base: '#4a4640', ink: '#a49b8a', alpha: 0.5, span: 4, weight: 700, glyph: (c, r, C, R, rand) => floor(c, r, rand) },
  platform: { base: '#3f4148', ink: '#9aa0ad', alpha: 0.5, span: 4, weight: 700, glyph: (c, r, C, R, rand) => floor(c, r, rand) },
  // The platform edge: a yellow strip of ▀ and ≡ rows.
  edge: { base: '#c9a227', ink: '#3a2f10', alpha: 0.55, span: 1, glyph: (c, r) => (r % 2 ? '≡' : '▀') },
  // Track bed: ═╪═ ties every half unit, ░ gravel between.
  track: { base: '#26231f', ink: '#7a6a55', alpha: 0.55, span: 4, glyph: (c, r, C, R, rand) => {
    const k = c % half(C);
    return k === 0 ? '╪' : k === 1 || k === half(C) - 1 ? '═' : pick(rand, [['░', 0.7], ['▒', 0.08], [' ', 0.22]]);
  } },
  // Stairs: ─ and ▁ treads.
  stair: { base: '#4b4a50', ink: '#b0b0bc', alpha: 0.55, span: 1, glyph: (c, r) => (r % 2 ? '▁' : '─') },
  // The kiosk's shutter: ▤ and ═ slats.
  kiosk: { base: '#5a2e2a', ink: '#d9a090', alpha: 0.5, span: 1, glyph: (c, r) => (r % 2 ? '═' : '▤') },
  // Pillars: ║ fluting.
  pillar: { base: '#55596a', ink: '#a9afc2', alpha: 0.5, span: 1, glyph: (c) => (c % 2 ? ['│', 0.6] : '║') },
  // Benches: ═ slats.
  bench: { base: '#5b4632', ink: '#c49a6c', alpha: 0.55, span: 1, glyph: () => '═' },
  // Turnstile steel: ─ brushing with a seeded ≡; the tops and rails ≡.
  steel: { base: '#7a8290', ink: '#d0d7e2', alpha: 0.45, span: 2, glyph: (c, r, C, R, rand) => (rand() < 0.15 ? '≡' : '─') },
  steelTop: { base: '#8f98a6', ink: '#e1e7f0', alpha: 0.45, span: 1, glyph: () => '≡' },
};

// A surface's texture: span × span world units of glyph cells at DENSITY.
export function asciiTexture(kind, { anisotropy = 1, density = DENSITY, seed = 7 } = {}) {
  const s = SURFACES[kind], C = density.cols, R = density.rows, size = PX * s.span;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = s.base; g.fillRect(0, 0, size, size);
  const cw = PX / C, ch = PX / R;
  g.fillStyle = s.ink; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `${s.weight || 400} ${Math.min(ch, cw / 0.6) * 0.95}px ${FONT}`;
  const rand = rng(seed * 9973 + kind.length * 131 + kind.charCodeAt(0));
  for (let row = 0; row < R * s.span; row++) for (let col = 0; col < C * s.span; col++) {
    let gl = s.glyph(col % C, row % R, C, R, rand), a = 1;
    if (Array.isArray(gl)) [gl, a] = gl;
    if (!gl || gl === ' ') continue;
    g.globalAlpha = s.alpha * a;
    g.fillText(gl, (col + 0.5) * cw, (row + 0.5) * ch);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / s.span, 1 / s.span);
  t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = anisotropy;
  return t;
}

// Map a material's texture by world position: each face takes the two world axes it lies along (box mapping), in
// world units, so the map's repeat (1 / span) sets the glyph size and every box, of any scale, shares one grid.
// Faces toward −x / −z are flipped so their glyphs read the right way round; floors read with north up.
export function worldMapped(material) {
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <uv_vertex>', `#include <uv_vertex>
#ifdef USE_MAP
  {
    vec4 wp = vec4( position, 1.0 );
    vec3 wn = normal;
    #ifdef USE_INSTANCING
      wp = instanceMatrix * wp; wn = mat3( instanceMatrix ) * wn;
    #endif
    wp = modelMatrix * wp; wn = mat3( modelMatrix ) * wn;
    vec3 an = abs( wn );
    vec2 wuv = an.y >= an.x && an.y >= an.z ? vec2( wp.x, -wp.z * sign( wn.y ) )
      : an.x >= an.z ? vec2( -wp.z * sign( wn.x ), wp.y ) : vec2( wp.x * sign( wn.z ), wp.y );
    vMapUv = ( mapTransform * vec3( wuv, 1.0 ) ).xy;
  }
#endif`);
  };
  material.customProgramCacheKey = () => 'ascii-world-mapped';
  return material;
}

// A matte material for a surface kind.
export function asciiMaterial(kind, own, { anisotropy = 1, roughness = 0.92, metalness = 0 } = {}) {
  return worldMapped(own(new THREE.MeshStandardMaterial({ map: own(asciiTexture(kind, { anisotropy })), roughness, metalness })));
}
