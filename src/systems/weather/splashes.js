// Impact splashes: shared ring buffer written by rain/drip compute shaders (random slot), rendered analytically:
// a thin crown sheet (cylindrical billboard) + ballistic bounce droplets drawn as tiny motion streaks.
import * as THREE from 'three/webgpu';
import {
  Fn, instancedArray, instanceIndex, float, vec2, vec3, vec4, uint, hash, select, clamp, normalize, length, uv, smoothstep, abs, sin, cos,
  viewportOpaqueMipTexture, screenUV, varyingProperty, attribute, cameraPosition, positionGeometry, max, min, pow, uniform, mix, If, step,
} from 'three/tsl';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import { U, streakQuad } from './common.js';

export const SPLASH_COUNT = 1 << 15;
const DROPLETS = 5;

export class Splashes {
  constructor(ctx) {
    this.ctx = ctx;
    this.count = SPLASH_COUNT;
    this.life = uniform(0.32);
    this.gain = uniform(1.0);
    this.bgGain = uniform(2.5);
    this.data = instancedArray(SPLASH_COUNT, 'vec4'); // xyz, birth time
    this.info = instancedArray(SPLASH_COUNT, 'vec4'); // rgb lit colour, drop radius (negative = big drip)
    this.build();
  }

  init(renderer) {
    const d = this.data;
    renderer.compute(Fn(() => { d.element(instanceIndex).assign(vec4(0, -10000, 0, -1000)); })().compute(SPLASH_COUNT));
  }

  // call inside a compute Fn
  emit(seed, p, color, radius, vel) {
    const slot = uint(hash(seed.mul(0.7531).add(13.37)).mul(SPLASH_COUNT - 1));
    this.data.element(slot).assign(vec4(p, U.time));
    this.info.element(slot).assign(vec4(color, radius));
  }

  build() {
    // geometry: crown quad (part 0) + DROPLETS streak quads (part 1..)
    const parts = [];
    for (let k = 0; k <= DROPLETS; k++) {
      const g = new THREE.PlaneGeometry(1, 1, 1, 1);
      const n = g.attributes.position.count;
      g.setAttribute('part', new THREE.Float32BufferAttribute(new Array(n).fill(k), 1));
      parts.push(g);
    }
    const geo = BufferGeometryUtils.mergeGeometries(parts);

    const D = this.data.toAttribute(), I = this.info.toAttribute();
    const life = this.life;
    const part = attribute('part', 'float');
    const vAlpha = varyingProperty('float', 'vSplA');
    const vCol = varyingProperty('vec3', 'vSplC');
    const vPart = varyingProperty('float', 'vSplP');
    const vSeed = varyingProperty('float', 'vSplS');
    const vAge = varyingProperty('float', 'vSplAge');

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = true;
    mat.positionNode = Fn(() => {
      const origin = D.xyz;
      const age = U.time.sub(D.w);
      const big = I.w.greaterThan(0.0035);
      const L = select(big, life.mul(1.6), life);
      const a = clamp(age.div(L), 0, 1);
      const alive = age.greaterThanEqual(0).and(age.lessThan(L));
      const radius = I.w;
      const rs = clamp(radius.div(0.002), 0.4, 3.0); // size scale
      const seed = hash(D.x.mul(12.9898).add(D.z.mul(78.233)));
      const out = vec3(0).toVar();
      const alpha = float(0).toVar();
      const dCam = length(cameraPosition.sub(origin));
      If(part.lessThan(0.5), () => {
        // crown: cylindrical billboard standing on the surface
        const toCam = cameraPosition.sub(origin);
        const side = normalize(vec3(toCam.z, 0, toCam.x.negate()).add(vec3(1e-6, 0, 0)));
        const w = rs.sqrt().mul(0.11).mul(a.sqrt().mul(0.9).add(0.3));
        const h = rs.sqrt().mul(0.07).mul(smoothstep(0.0, 0.15, a)).mul(float(1).sub(a.mul(0.6)));
        const pixMin = dCam.mul(U.pixK).mul(2.5);
        const ww = max(w, pixMin);
        const hh = max(h, pixMin.mul(0.6));
        out.assign(origin.add(side.mul(positionGeometry.x.mul(ww))).add(vec3(0, positionGeometry.y.add(0.5).mul(hh), 0)));
        alpha.assign(pow(float(1).sub(a), 1.6).mul(min(w.div(ww), 1.0).mul(0.6).add(0.4)));
      }).Else(() => {
        // bounce droplet k: ballistic arc, rendered as a tiny motion streak
        const k = part;
        const ang = seed.mul(6.2831).add(k.mul(6.2831 / DROPLETS)).add(hash(seed.add(k)).mul(0.9));
        const hs = hash(seed.mul(3.1).add(k.mul(1.7)));
        const spd = rs.sqrt().mul(hs.mul(0.9).add(0.5));
        const up = rs.sqrt().mul(hash(seed.add(k.mul(5.3))).mul(1.3).add(0.9));
        const v0 = vec3(cos(ang).mul(spd), up, sin(ang).mul(spd));
        const p = origin.add(v0.mul(age)).add(vec3(0, -4.9, 0).mul(age.mul(age)));
        const vel = v0.add(vec3(0, -9.8, 0).mul(age));
        const dr = radius.mul(0.35).max(0.0004);
        const q = streakQuad(p, vel.mul(0.03), dr, 0.7);
        out.assign(q.world);
        alpha.assign(q.coverage.mul(float(1).sub(a)).mul(select(p.y.greaterThan(origin.y.sub(0.01)), float(1), float(0))));
      });
      const distFade = float(1).sub(smoothstep(18.0, 32.0, dCam));
      vAlpha.assign(select(alive, alpha.mul(distFade).mul(U.rain.mul(0.7).add(0.3)), float(0)));
      vCol.assign(I.xyz);
      vPart.assign(part);
      vSeed.assign(seed);
      vAge.assign(a);
      // collapse dead splashes far away (zero area)
      return select(alive, out, vec3(0, -10000, 0));
    })();

    const u = uv();
    const bg = viewportOpaqueMipTexture(screenUV, float(4.0)).rgb;
    // crown silhouette: walls brighter at the rim/edges, spiky top
    const x = u.x.mul(2).sub(1);
    const ax = abs(x);
    // crown seen from the side: an elliptical rim ring at the top (opening widens/drops with age), thin translucent
    // walls flaring out from the impact point, and a bright impact bead at the base during the first frames.
    const rimY = float(0.82).sub(vAge.mul(0.25));
    const ry = float(0.16);
    const e = x.mul(x).add(u.y.sub(rimY).div(ry).pow(2.0));
    const spikes = sin(x.mul(19.0).add(vSeed.mul(40.0))).mul(0.5).add(0.5);
    const rimA = smoothstep(0.32, 0.0, abs(e.sub(1.0))).mul(spikes.mul(0.5).add(0.5));
    const wallEdge = abs(x).sub(u.y.div(rimY).pow(0.7));
    const wallA = smoothstep(0.18, 0.0, abs(wallEdge)).mul(step(u.y, rimY)).mul(0.55);
    const bead = smoothstep(0.35, 0.0, length(vec2(x.mul(1.4), u.y.mul(3.0)))).mul(smoothstep(0.35, 0.0, vAge)).mul(1.5);
    const crownA = max(max(rimA, wallA), bead);
    const across = float(1).sub(abs(u.x.mul(2).sub(1)));
    const along = smoothstep(0.0, 0.3, u.y).mul(smoothstep(1.0, 0.7, u.y));
    const dropA = across.mul(across).mul(along);
    const shapeA = select(vPart.lessThan(0.5), crownA, dropA);
    mat.colorNode = vCol.mul(4.0).add(U.ambient.mul(2.0)).add(bg.mul(this.bgGain)).mul(this.gain);
    mat.opacityNode = clamp(vAlpha.mul(shapeA), 0, 1);
    this.material = mat;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.count = SPLASH_COUNT;
    mesh.frustumCulled = false;
    mesh.renderOrder = 11;
    mesh.name = 'weather.splashes';
    this.mesh = mesh;
  }
}
