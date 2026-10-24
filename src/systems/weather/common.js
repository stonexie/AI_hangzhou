// Shared uniforms + TSL helpers for the weather system.
import * as THREE from 'three/webgpu';
import { uniform, Fn, float, vec3, vec4, floor, max, min, clamp, pow, dot, normalize, length, exp, Loop, int, vec2, cross, sign, cameraPosition, positionGeometry } from 'three/tsl';

export const U = {
  time: uniform(0),          // deterministic engine time (s)
  dt: uniform(1 / 60),
  frame: uniform(0),
  cam: uniform(new THREE.Vector3()),
  camVel: uniform(new THREE.Vector3()),
  wind: uniform(new THREE.Vector2(0.6, -0.25)), // m/s scaled
  gust: uniform(1.0),        // global gust multiplier (CPU-driven)
  rain: uniform(1.0),        // rain intensity 0..1
  lightning: uniform(0),     // flash 0..1
  ambient: uniform(new THREE.Color(0.05, 0.06, 0.09)), // ambient scatter colour for particles (from fog colour)
  pixK: uniform(0.001),      // world size of one pixel at distance 1m
};

// soft saturation of light colour (keeps hue, avoids blown blobs right next to lamps)
export const softClamp = (c, k = 0.35) => c.div(max(max(c.x, c.y), c.z).mul(k).add(1));

// floored modulo that behaves for negatives
export const fmod = (x, y) => x.sub(y.mul(floor(x.div(y))));

// mulberry32 seeded RNG for CPU placement
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Light contribution at world point p seen from the camera, with forward-scattering phase (water drops/steam glow
// strongly when back-lit). Returns vec3.
export function makeLightFn(lights, maxLights, { g = 0.72, iso = 0.25 } = {}) {
  return Fn(([p, viewDir]) => {
    const acc = vec3(0).toVar();
    Loop({ start: int(0), end: int(maxLights), type: 'int', condition: '<' }, ({ i }) => {
      const L = lights.uPos.element(i);
      const C = lights.uCol.element(i);
      const d = L.xyz.sub(p);
      const d2 = dot(d, d);
      const dist = d2.sqrt();
      const rr = dist.div(L.w);
      const win = clamp(float(1).sub(rr.mul(rr).mul(rr).mul(rr)), 0, 1);
      const atten = win.mul(win).div(d2.add(0.35));
      // cos between light->point direction and point->camera direction
      const cosT = dot(d.div(dist.add(1e-4)).negate(), viewDir);
      const g2 = g * g;
      const hg = float(1 - g2).div(pow(float(1 + g2).sub(cosT.mul(2 * g)), 1.5));
      acc.addAssign(C.rgb.mul(atten).mul(hg.mul(0.35).add(iso)));
    });
    return acc;
  });
}

// Builds a camera-facing quad stretched along a motion vector (thin motion-blurred streak).
// geometry: PlaneGeometry(1,1): x across, y along (-0.5 tail .. +0.5 head). Returns { world, coverage, dist, halfW }.
export function streakQuad(head, motion, radius, minPixels = 0.75) {
  const tail = head.sub(motion);
  const axis = head.sub(tail);
  const center = head.add(tail).mul(0.5);
  const toCam = cameraPosition.sub(center);
  const dist = length(toCam);
  const side = normalize(cross(axis, toCam).add(vec3(1e-7, 0, 1e-7)));
  const pix = dist.mul(U.pixK);
  const halfW = max(radius, pix.mul(minPixels));
  const coverage = radius.div(halfW);
  const axisN = normalize(axis.add(vec3(0, -1e-6, 0)));
  const y = positionGeometry.y;
  const world = center.add(axis.mul(y)).add(axisN.mul(sign(y).mul(halfW))).add(side.mul(positionGeometry.x.mul(halfW.mul(2))));
  return { world, coverage, dist, halfW };
}
