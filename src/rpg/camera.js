// The station's camera (station spec §4): pitched 35° down, 10 back, following a point 1 above you on a
// 0.15 s spring, kept inside the map, never rotating. Pure: index.js copies it onto the three.js camera.
export const CAM = { pitch: (35 * Math.PI) / 180, dist: 10, lift: 1, spring: 0.15, bridge: 16, bridgePitch: (12 * Math.PI) / 180, inside: 7, zoom: 0.8 }; // inside: closer in a train's car (Faiz's ask)

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
  // The distance eases toward cam.want (further out on the bridge, spec §4), on its own slower spring.
  cam.dist ??= CAM.dist;
  cam.dist += ((cam.want ?? CAM.dist) - cam.dist) * (dt > 0 ? 1 - Math.exp(-dt / CAM.zoom) : 0);
  // And tips up toward cam.wantPitch: from 35° the view never reaches the horizon, and the skyline is out there.
  cam.pitch ??= CAM.pitch;
  cam.pitch += ((cam.wantPitch ?? CAM.pitch) - cam.pitch) * (dt > 0 ? 1 - Math.exp(-dt / CAM.zoom) : 0);
  const hw = tilesAcross(aspect) / 2, hd = Math.min(4, hw / aspect);
  // Keeps the focus off the map's edges: the screen's sides at the focus stay inside the map, and the focus
  // stays off the north and south walls. At 35° the view still reaches past them (about 15 north, 3 south);
  // the outer walls and the dark hide that.
  const x0 = map.x0 ?? 0;
  if (Number.isFinite(map.cols)) cam.x = clamp(cam.x, x0 + hw, x0 + map.cols - hw);
  if (Number.isFinite(map.rows)) cam.z = clamp(cam.z, hd * 0.25, map.rows - hd * 0.5);
  return cam;
}

// v kept within [lo, hi]; an empty range (lo > hi) gives its middle. Shared with rig.js.
export const clamp = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, v)));

export const eyeFor = (cam) => ({ x: cam.x, y: cam.y + Math.sin(cam.pitch ?? CAM.pitch) * (cam.dist ?? CAM.dist), z: cam.z + Math.cos(cam.pitch ?? CAM.pitch) * (cam.dist ?? CAM.dist) });
