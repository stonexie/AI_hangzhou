// Gathers the scene's point/spot lights nearest the camera into small uniform arrays so particle shaders
// (rain, splashes, drips, steam) can be lit by the actual neon/lamp lights (forward-scattering in drops).
import * as THREE from 'three/webgpu';
import { uniformArray, uniform } from 'three/tsl';

export const MAX_LIGHTS = 24;

export class LightGather {
  constructor(ctx) {
    this.ctx = ctx;
    this.lights = [];
    this.pos = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, -9999, 0, 1));
    this.col = Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4(0, 0, 0, 0));
    this.uPos = uniformArray(this.pos, 'vec4'); // xyz, range
    this.uCol = uniformArray(this.col, 'vec4'); // rgb*intensity, unused
    this.count = uniform(0, 'int');
    this.nextScan = 0;
    this._v = new THREE.Vector3();
    this._c = new THREE.Color();
  }

  scan() {
    const list = [];
    this.ctx.scene.traverse((o) => { if ((o.isPointLight || o.isSpotLight) && o.intensity > 0) list.push(o); });
    this.lights = list;
  }

  update(t) {
    if (t >= this.nextScan) { this.scan(); this.nextScan = t + 2.0; }
    const cam = this.ctx.camera.position;
    const scored = [];
    for (const l of this.lights) {
      if (!l.visible) continue;
      l.getWorldPosition(this._v);
      const d2 = this._v.distanceToSquared(cam);
      const range = l.distance > 0 ? l.distance : 25;
      if (d2 > (range + 45) * (range + 45)) continue;
      // importance: intensity weighted by inverse distance to camera
      scored.push({ l, p: this._v.clone(), range, s: (l.intensity * Math.max(range, 4)) / (d2 + 25) });
    }
    scored.sort((a, b) => b.s - a.s);
    const n = Math.min(MAX_LIGHTS, scored.length);
    for (let i = 0; i < MAX_LIGHTS; i++) {
      if (i < n) {
        const { l, p, range } = scored[i];
        this.pos[i].set(p.x, p.y, p.z, range);
        this._c.copy(l.color).multiplyScalar(l.intensity);
        this.col[i].set(this._c.r, this._c.g, this._c.b, 1);
      } else {
        this.pos[i].set(0, -9999, 0, 1);
        this.col[i].set(0, 0, 0, 0);
      }
    }
    this.count.value = n;
  }
}
