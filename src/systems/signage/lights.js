// Light pool: hundreds of candidate sign/lamp lights, but only the N most relevant to the camera are
// bound to real PointLights each re-rank (clustered lighting cost stays bounded, per-cluster caps respected).
import * as THREE from 'three/webgpu';

export function pcg(x) {
  let s = (Math.max(0, Math.trunc(x)) >>> 0);
  s = (Math.imul(s, 747796405) + 2891336453) >>> 0;
  const w = Math.imul(((s >>> ((s >>> 28) + 4)) ^ s) >>> 0, 277803737) >>> 0;
  return (((w >>> 22) ^ w) >>> 0) / 4294967296;
}

// JS twin of materials.flickerNode for seg = 0 (whole-sign light level)
export function flickerJS(seed, type, t) {
  if (type < 0.5) return 1;
  const burst = pcg(Math.floor(t * 0.7) + seed * 7919);
  const fast = pcg(Math.floor(t * 23) + seed * 4999);
  const stutter = burst > 0.72 ? (fast >= 0.38 ? 1 : 0.08) : 1;
  if (type < 1.5) return stutter;
  if (type < 2.5) return 0.85 * (stutter * 0.3 + 0.7);
  if (type < 3.5) return 0.65;
  return Math.sin(t * 1.7 + seed * 0.4) * 0.18 + 0.86;
}

export class LightPool {
  constructor(scene, size = 200) {
    this.size = size;
    this.cands = [];
    this.lights = [];
    this.assign = new Array(size).fill(-1);
    for (let i = 0; i < size; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 0.01, 2);
      l.position.set(0, -2000 - i, 0);
      l.castShadow = false;
      scene.add(l);
      this.lights.push(l);
    }
    this.frame = 0;
    this._v = new THREE.Vector3();
  }

  // c: { pos: Vector3, color: [r,g,b], intensity, distance, seed, ftype, importance, fn?: (t)=>factor }
  add(c) {
    c.importance ??= 1; c.seed ??= 0; c.ftype ??= 0;
    c.color = new THREE.Color(c.color[0], c.color[1], c.color[2]);
    this.cands.push(c);
    return c;
  }

  rank(cam) {
    const cp = cam.position;
    const fwd = this._v.set(0, 0, -1).applyQuaternion(cam.quaternion);
    const scored = [];
    for (let i = 0; i < this.cands.length; i++) {
      const c = this.cands[i];
      const dx = c.pos.x - cp.x, dy = c.pos.y - cp.y, dz = c.pos.z - cp.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 170) continue;
      // in front of camera counts more (lights behind still matter a bit for reflections)
      const facing = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / Math.max(d, 1e-3);
      const s = c.importance * c.intensity * (facing > -0.2 ? 1 : 0.35) / (1 + d * d * 0.004);
      scored.push([s, i]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    for (let k = 0; k < this.size; k++) this.assign[k] = k < scored.length ? scored[k][1] : -1;
  }

  update(cam, t) {
    if (this.frame++ % 20 === 0) this.rank(cam);
    for (let k = 0; k < this.size; k++) {
      const l = this.lights[k], ci = this.assign[k];
      if (ci < 0) { l.intensity = 0; l.distance = 0.01; l.position.set(0, -2000 - k, 0); continue; }
      const c = this.cands[ci];
      l.position.copy(c.pos);
      l.color.copy(c.color);
      l.distance = c.distance;
      let f = flickerJS(c.seed, c.ftype, t);
      if (c.fn) f *= c.fn(t);
      l.intensity = c.intensity * f;
    }
  }
}
