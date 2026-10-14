// Night colours. The photos should always be the brightest thing on screen.
export const C = {
  bg: [7, 8, 11],
  floorDot: [34, 38, 48],
  wall: [64, 70, 86],
  wallBg: [15, 17, 23],
  frame: [92, 96, 108],
  frameFocus: [244, 238, 222],
  plaque: [104, 106, 116],
  title: [214, 170, 98],
  subtitle: [112, 110, 106],
  name: [236, 232, 220],
  tagline: [150, 146, 138],
  about: [124, 122, 118],
  sign: [98, 102, 116],
  prop: [130, 46, 38],
  player: [255, 206, 110],
  // darkroom (safelight) variants
  dWall: [92, 26, 22],
  dWallBg: [22, 6, 6],
  dFloorDot: [52, 14, 12],
  dLine: [120, 44, 36],
  dFrame: [150, 50, 40],
};

export const LABEL_COLOR = {
  title: C.title, subtitle: C.subtitle, name: C.name, tagline: C.tagline, about: C.about, sign: C.sign, kiosk: C.name,
};

export function hsl(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}

// Per-room accent colours: titles, floor dots, wall tint. Silver (hue null) stays grey.
export function roomTint(room) {
  if (!room || room.hue == null || room.id === 'lobby') return { title: C.title, dot: C.floorDot, wall: C.wall };
  return { title: hsl(room.hue, 60, 64), dot: hsl(room.hue, 35, 18), wall: hsl(room.hue, 22, 32) };
}
