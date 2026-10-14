// GLSL for renderer C.

// Pass 1a: the tile map. One full-screen triangle; each scene texel looks up its world cell's tile colour.
export const TILES_VS = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main() { v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

export const TILES_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tiles;   // rgb = colour, a = glyph brightness, one texel per world cell
uniform vec2 u_origin;       // world cell at the scene's top-left
uniform vec2 u_cells;        // scene size in cells
uniform vec2 u_mapSize;
out vec4 o;
void main() {
  vec2 cell = floor(u_origin + v_uv * u_cells); // row 0 = top
  if (any(lessThan(cell, vec2(0.0))) || any(greaterThanEqual(cell, u_mapSize))) { o = vec4(0.027, 0.031, 0.043, 0.0); return; }
  o = texelFetch(u_tiles, ivec2(cell), 0);
}`;

// Pass 1b: photos as textured quads in world-cell coordinates.
export const PHOTO_VS = `#version 300 es
in vec2 a_pos; // 0..1 quad
uniform vec4 u_rect;   // x, y, w, h in world cells
uniform vec4 u_uv;     // the part of the image to show (x, y, w, h in 0..1)
uniform vec2 u_origin, u_cells;
out vec2 v_uv;
void main() {
  v_uv = u_uv.xy + a_pos * u_uv.zw;
  vec2 p = (u_rect.xy + a_pos * u_rect.zw - u_origin) / u_cells;
  gl_Position = vec4(p.x * 2.0 - 1.0, p.y * 2.0 - 1.0, 0.0, 1.0); // scene rows run top-down
}`;

export const PHOTO_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_img;
uniform vec2 u_range;  // per-photo luminance stretch (lo, hi)
uniform float u_mono;  // 1 = darkroom red
out vec4 o;
void main() {
  vec3 c = texture(u_img, v_uv).rgb;
  float l = clamp((dot(c, vec3(0.2126, 0.7152, 0.0722)) - u_range.x) / (u_range.y - u_range.x), 0.0, 1.0);
  vec3 red = vec3(90.0 + 165.0 * l, 20.0 * l, 16.0 * l) / 255.0;
  o = vec4(mix(c, red, u_mono), 0.5 + 0.5 * l); // alpha ≥ 0.5 marks photo cells
}`;

// Pass 2: the ASCII pass. Every output pixel finds its world cell, averages that cell of the scene,
// picks a glyph by brightness and draws it in the cell's colour over a dimmed background.
export const ASCII_VS = TILES_VS;

export const ASCII_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;   // mipmapped; level 2 texel = 4x4 scene texels, a cell is 1x2 of those
uniform sampler2D u_atlas;
uniform vec2 u_view;         // view origin in world cells (top-left, fractional)
uniform vec2 u_cellPx;       // cell size in device pixels
uniform vec2 u_origin;       // scene origin in world cells (integer)
uniform float u_canvasH;
uniform float u_atlasCols;
uniform vec2 u_atlasGlyphs;  // atlas size in glyphs (cols, rows)
uniform float u_ramp[10];    // atlas index of each ramp glyph
out vec4 o;

vec3 saturate(vec3 c, float amt) { float l = dot(c, vec3(0.2126, 0.7152, 0.0722)); return clamp(vec3(l) + (c - vec3(l)) * amt, 0.0, 1.0); }

void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y);
  vec2 w = u_view + px / u_cellPx;
  vec2 cell = floor(w);
  vec2 local = w - cell;
  ivec2 t = ivec2(cell - u_origin) * ivec2(1, 2);
  vec4 a = texelFetch(u_scene, t, 2);
  vec4 b = texelFetch(u_scene, t + ivec2(0, 1), 2);
  vec4 s = (a + b) * 0.5;
  vec3 col = s.rgb;
  float isPhoto = step(0.5, s.a);
  float lum = isPhoto > 0.5 ? (s.a - 0.5) * 2.0 : s.a / 0.49;
  int gi = int(min(9.0, floor(lum * 10.0)));
  float glyph = u_ramp[gi];
  vec2 g = vec2(mod(glyph, u_atlasCols), floor(glyph / u_atlasCols));
  float ink = texture(u_atlas, (g + local) / u_atlasGlyphs).a;
  vec3 fg = saturate(col, 1.25);
  float mx = max(fg.r, max(fg.g, fg.b));
  fg += max(0.0, 70.0 / 255.0 - mx);
  vec3 bg = col * 0.42 * max(isPhoto, smoothstep(0.15, 0.3, lum)); // faint floor dots get no background block
  o = vec4(mix(bg, fg, ink), 1.0);
}`;

// Pass 3: exact glyphs (labels, plaques, borders, @, visitors) as instanced quads.
export const GLYPH_VS = `#version 300 es
in vec2 a_pos;
in vec3 i_cell;   // x, y (world cells), glyph index
in vec3 i_fg;
in vec4 i_bg;
uniform vec2 u_view, u_viewCells;
uniform float u_atlasCols;
out vec2 v_glyphUv;
out vec3 v_fg;
out vec4 v_bg;
void main() {
  vec2 p = (i_cell.xy + a_pos - u_view) / u_viewCells;
  gl_Position = vec4(p.x * 2.0 - 1.0, 1.0 - p.y * 2.0, 0.0, 1.0);
  v_glyphUv = vec2(mod(i_cell.z, u_atlasCols), floor(i_cell.z / u_atlasCols)) + a_pos;
  v_fg = i_fg;
  v_bg = i_bg;
}`;

export const GLYPH_FS = `#version 300 es
precision highp float;
in vec2 v_glyphUv;
in vec3 v_fg;
in vec4 v_bg;
uniform sampler2D u_atlas;
uniform vec2 u_atlasGlyphs;
out vec4 o;
void main() {
  float ink = texture(u_atlas, v_glyphUv / u_atlasGlyphs).a;
  float a = ink + v_bg.a * (1.0 - ink);
  o = vec4(v_fg * ink + v_bg.rgb * v_bg.a * (1.0 - ink), a); // premultiplied
}`;

// Pass 2b: lighting. One texel per cell (smoothly filtered), multiplied over the frame; a second draw
// adds the lantern's haze.
export const LIGHT_FS = `#version 300 es
precision highp float;
uniform sampler2D u_light;
uniform vec2 u_view, u_cellPx, u_lorigin, u_lsize;
uniform float u_canvasH;
out vec4 o;
void main() {
  vec2 px = vec2(gl_FragCoord.x, u_canvasH - gl_FragCoord.y);
  vec2 cell = u_view + px / u_cellPx;
  o = vec4(texture(u_light, (cell - u_lorigin) / u_lsize).rgb, 1.0);
}`;
