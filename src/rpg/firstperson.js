// First person in the station (Faiz's ask): C swaps the camera from over your shoulder to your eyes. The mouse
// looks (the pointer locked on a click, or a drag), and the walking keys go where you look: W ahead, S back,
// A and D sideways. Pure: index.js puts the camera there and hides your own figure.
// Yaw as the rig has it: 0 faces south (+z), π/2 east (+x). Pitch: up is positive.
export const FP = { fov: 72, sens: 0.0024, pitchMax: 1.3, eye: 0.08 }; // eye: above the head joint's centre

export const createLook = (yaw = 0) => ({ yaw, pitch: 0 });

// The mouse moved dx, dy pixels: right turns right, up looks up.
export function look(l, dx, dy) {
  l.yaw -= dx * FP.sens;
  l.pitch = Math.max(-FP.pitchMax, Math.min(FP.pitchMax, l.pitch - dy * FP.sens));
  return l;
}

// The keys ({ x: right, y: back }, as the museum reads them) turned to the world's x and z (walker input's y).
export function fpInput(input, yaw) {
  const ahead = -(input.y || 0), side = input.x || 0, s = Math.sin(yaw), c = Math.cos(yaw);
  // Ahead is (sin, cos); your right hand, facing that way with up above you, is (−cos, sin).
  const x = ahead * s - side * c, y = ahead * c + side * s;
  return { x: Math.abs(x) < 1e-12 ? 0 : x, y: Math.abs(y) < 1e-12 ? 0 : y, run: !!input.run };
}

// A point one unit ahead of the eye, along the look.
export function lookPoint(eye, l) {
  const c = Math.cos(l.pitch);
  return { x: eye.x + Math.sin(l.yaw) * c, y: eye.y + Math.sin(l.pitch), z: eye.z + Math.cos(l.yaw) * c };
}
