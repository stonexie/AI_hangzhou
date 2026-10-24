import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, uniform, texture, smoothstep, abs, dot, normalize, normalView, positionView, positionLocal,
  atan, time, max, pow,
} from 'three/tsl';
import { noiseTex, U } from './atmo.js';

// Cheap volumetric light shaft (god-ray cone) for street lamps / spotlights / sign spill in rainy air.
// Additive, depth-tested, no depth write, soft edges via view-angle falloff, animated falling-rain streaks inside.
// Usage (other systems): ctx.api.atmosphere.createLightShaft({ position, direction, length, radius, color, intensity })
const _down = new THREE.Vector3(0, -1, 0);
const geoCache = new Map();

function coneGeometry() {
  if (!geoCache.has('cone')) {
    const g = new THREE.CylinderGeometry(0.06, 1, 1, 24, 1, true);
    g.translate(0, -0.5, 0); // apex (narrow end) at origin, base at y=-1
    geoCache.set('cone', g);
  }
  return geoCache.get('cone');
}

export function createLightShaft({
  position = new THREE.Vector3(), direction = _down, length = 6, radius = 2, color = new THREE.Color(1, 0.8, 0.6),
  intensity = 0.08,
} = {}) {
  const pos = position.isVector3 ? position : new THREE.Vector3(...position);
  const dir = (direction.isVector3 ? direction.clone() : new THREE.Vector3(...direction)).normalize();
  const col = color.isColor ? color : new THREE.Color(color);

  const mat = new THREE.MeshBasicNodeMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false,
  });
  const uCol = uniform(new THREE.Vector3(col.r, col.g, col.b));
  const uInt = uniform(intensity * 0.25);
  const t = positionLocal.y.negate(); // 0 at apex, 1 at base
  const facing = abs(dot(normalize(normalView), normalize(positionView.negate())));
  const edge = pow(facing, 3.0).mul(smoothstep(1.5, 6.0, positionView.z.negate()));
  const along = pow(float(1).sub(t), 1.4).mul(smoothstep(0.0, 0.06, t));
  const ang = atan(positionLocal.x, positionLocal.z);
  const streak = texture(noiseTex, vec2(ang.mul(1.2), positionLocal.y.mul(length * 0.05).add(time.mul(0.9)))).b;
  const rain = streak.mul(streak).mul(1.6).add(0.45);
  const rainAmt = U.rain.mul(0.6).add(0.4);
  const a = edge.mul(along).mul(rain.mul(rainAmt).add(float(1).sub(rainAmt))).mul(uInt);
  mat.colorNode = uCol.mul(a);
  mat.opacityNode = float(1);

  const mesh = new THREE.Mesh(coneGeometry(), mat);
  mesh.scale.set(radius, length, radius);
  mesh.position.copy(pos);
  mesh.quaternion.setFromUnitVectors(_down, dir);
  mesh.renderOrder = 10;
  mesh.frustumCulled = true;
  mesh.userData.shaft = { color: uCol, intensity: uInt };
  mesh.name = 'atmo.lightShaft';
  return mesh;
}
