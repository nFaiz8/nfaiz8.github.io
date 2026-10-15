// The station's camera (station spec §4): pitched 35° down, 10 back, following a point 1 above you on a
// 0.15 s spring, kept inside the map, never rotating. Pure: index.js copies it onto the three.js camera.
export const CAM = { pitch: (35 * Math.PI) / 180, dist: 10, lift: 1, spring: 0.15 };

export const tilesAcross = (aspect) => (aspect >= 1 ? 12 : 8);

// The vertical field of view, in degrees, that shows tilesAcross(aspect) tiles across at the focus.
export function fovFor(aspect) {
  const halfH = tilesAcross(aspect) / 2 / aspect;
  return (2 * Math.atan(halfH / CAM.dist) * 180) / Math.PI;
}

export const createCamera = (t) => ({ x: t.x, y: t.y + CAM.lift, z: t.z });

export function followCamera(cam, t, dt, map, aspect) {
  const k = dt > 0 ? 1 - Math.exp(-dt / CAM.spring) : 0;
  cam.x += (t.x - cam.x) * k;
  cam.y += (t.y + CAM.lift - cam.y) * k;
  cam.z += (t.z - cam.z) * k;
  const hw = tilesAcross(aspect) / 2, hd = Math.min(4, hw / aspect);
  cam.x = clamp(cam.x, hw, map.cols - hw);
  cam.z = clamp(cam.z, hd * 0.25, map.rows - hd * 0.5);
  return cam;
}

const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

export const eyeFor = (cam) => ({ x: cam.x, y: cam.y + Math.sin(CAM.pitch) * CAM.dist, z: cam.z + Math.cos(CAM.pitch) * CAM.dist });
