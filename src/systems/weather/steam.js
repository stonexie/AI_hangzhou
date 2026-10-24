// Steam plumes (manholes, vents, ramen exhaust) + low ground mist (alley, river). Analytic GPU particles
// (no compute): each instance derives its age/position from time, so it's free of state and deterministic.
// Soft particles (scene depth fade), lit by nearby lights with forward scattering + blurred scene colour behind.
import * as THREE from 'three/webgpu';
import {
  Fn, instanceIndex, float, vec2, vec3, vec4, hash, select, clamp, normalize, length, uv, smoothstep, sin, cos, fract, cross,
  viewportOpaqueMipTexture, screenUV, varyingProperty, uniform, uniformArray, texture, positionGeometry, cameraPosition,
  viewportDepthTexture, perspectiveDepthToViewZ, cameraNear, cameraFar, positionView, mix, pow, max, uint, floor,
} from 'three/tsl';
import { U, makeLightFn, mulberry32, softClamp } from './common.js';
import { MAX_LIGHTS } from './lights.js';

// CPU-generated 2x2 atlas of soft billowy puffs (tileable value-noise fbm masked by radial falloff)
function makePuffAtlas(size = 256) {
  const rng = mulberry32(777);
  const N = 64;
  const grid = new Float32Array(N * N);
  for (let i = 0; i < grid.length; i++) grid[i] = rng();
  const vn = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const s = (t) => t * t * (3 - 2 * t);
    const g = (a, b) => grid[((b & (N - 1)) * N) + (a & (N - 1))];
    const a = g(xi, yi), b = g(xi + 1, yi), c = g(xi, yi + 1), d = g(xi + 1, yi + 1);
    return a + (b - a) * s(xf) + (c - a) * s(yf) + (a - b - c + d) * s(xf) * s(yf);
  };
  const data = new Uint8Array(size * size * 4);
  const half = size / 2;
  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * half, oy = Math.floor(q / 2) * half;
    const sx = q * 17.3, sy = q * 9.1;
    for (let y = 0; y < half; y++) for (let x = 0; x < half; x++) {
      const u = x / half - 0.5, v = y / half - 0.5;
      let n = 0, amp = 0.5, f = 4;
      for (let o = 0; o < 5; o++) { n += amp * vn(u * f + sx, v * f + sy); f *= 2.03; amp *= 0.5; }
      const r = Math.sqrt(u * u + v * v) * 2;
      const fall = Math.max(0, 1 - r) ** 1.4;
      let a = fall * (0.35 + 1.1 * n) - 0.18 * (1 - fall);
      a = Math.max(0, Math.min(1, a * 1.25));
      const idx = ((oy + y) * size + ox + x) * 4;
      data[idx] = data[idx + 1] = data[idx + 2] = 255;
      data[idx + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// emitter types: 0 = plume (vent/manhole), 1 = exhaust (sideways from wall, normal in params), 2 = ground mist
export class Steam {
  constructor(ctx, { emitters, lights, perEmitter = 48 } = {}) {
    this.ctx = ctx;
    this.M = perEmitter;
    this.E = emitters.length;
    this.N = this.E * this.M;
    this.emitters = emitters;
    this.tex = makePuffAtlas();
    this.lights = lights;
    this.build();
  }

  build() {
    const { M } = this;
    const A = this.emitters.map((e) => new THREE.Vector4(e.pos[0], e.pos[1], e.pos[2], e.type));
    const B = this.emitters.map((e) => new THREE.Vector4(e.dir?.[0] ?? 0, e.dir?.[1] ?? 1, e.dir?.[2] ?? 0, e.strength ?? 1));
    const C = this.emitters.map((e) => new THREE.Vector4(e.size ?? 1, e.spread ?? 1, e.life ?? 4, e.speed ?? 1));
    const uA = uniformArray(A, 'vec4'), uB = uniformArray(B, 'vec4'), uC = uniformArray(C, 'vec4');
    const lightAt = makeLightFn(this.lights, MAX_LIGHTS, { g: 0.55, iso: 0.35 });
    const vA = varyingProperty('float', 'vStA');
    const vC = varyingProperty('vec3', 'vStC');
    const vUV = varyingProperty('vec2', 'vStUV');

    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = true;
    mat.positionNode = Fn(() => {
      const i = instanceIndex;
      const e = i.div(uint(M));
      const k = float(i.mod(uint(M)));
      const a = uA.element(e), b = uB.element(e), c = uC.element(e);
      const type = a.w;
      const h1 = hash(float(i).mul(1.731).add(0.37)), h2 = hash(float(i).mul(2.113).add(5.1)), h3 = hash(float(i).mul(0.917).add(9.3));
      const life = c.z.mul(h3.mul(0.5).add(0.75));
      const phase = fract(U.time.div(life).add(k.div(M)).add(h1));
      const age = phase.mul(life);
      const isMist = type.greaterThan(1.5);
      const dir = b.xyz;
      const speed = c.w;
      // rise with deceleration, drift with wind (stronger as it rises), wobble
      const rise = speed.mul(age).div(age.mul(0.35).add(1.0));
      const drift = vec3(U.wind.x, 0, U.wind.y).mul(U.gust).mul(age.mul(age).mul(0.08).add(age.mul(0.15)));
      const wob = vec3(sin(age.mul(1.7).add(h2.mul(30.0))), sin(age.mul(1.1).add(h1.mul(20.0))).mul(0.3), cos(age.mul(1.3).add(h3.mul(25.0)))).mul(age.mul(0.12).mul(c.y));
      const jitter = vec3(h1.sub(0.5), 0, h2.sub(0.5)).mul(c.y.mul(0.35));
      const plumeP = a.xyz.add(jitter).add(dir.mul(rise)).add(drift).add(wob);
      // mist: wide random placement around emitter, slow drift, lifecycle only in alpha
      const mistP = a.xyz.add(vec3(h1.sub(0.5).mul(c.y), h3.mul(0.6), h2.sub(0.5).mul(c.y))).add(vec3(U.wind.x, 0, U.wind.y).mul(age.mul(0.25)));
      const center = select(isMist, mistP, plumeP);
      const size = select(isMist, c.x.mul(h3.mul(0.6).add(0.7)), c.x.mul(age.mul(0.55).add(0.35)).mul(h2.mul(0.5).add(0.75)));
      const toCam = cameraPosition.sub(center);
      const dist = length(toCam);
      const f = toCam.div(dist);
      const right = normalize(cross(vec3(0, 1, 0), f).add(vec3(1e-5, 0, 0)));
      const up = cross(f, right);
      const rot = h1.mul(6.283).add(age.mul(select(h2.greaterThan(0.5), float(0.25), float(-0.25))));
      const cs = cos(rot), sn = sin(rot);
      const gx = positionGeometry.x.mul(cs).sub(positionGeometry.y.mul(sn));
      const gy = positionGeometry.x.mul(sn).add(positionGeometry.y.mul(cs));
      const world = center.add(right.mul(gx.mul(size))).add(up.mul(gy.mul(size)));
      const fadeIn = smoothstep(0.0, select(isMist, float(0.3), float(0.08)), phase);
      const fadeOut = pow(float(1).sub(phase), select(isMist, float(1.0), float(1.3)));
      const nearFade = smoothstep(0.4, 2.5, dist.sub(size.mul(0.3)));
      vA.assign(fadeIn.mul(fadeOut).mul(b.w).mul(nearFade));
      const lit = softClamp(lightAt(center, f).mul(0.06), 0.8);
      vC.assign(U.ambient.mul(3.0).add(vec3(0.05, 0.055, 0.07)).add(lit).add(vec3(0.5, 0.55, 0.7).mul(U.lightning.mul(1.5))));
      // atlas cell
      const cell = floor(h2.mul(3.999));
      vUV.assign(vec2(cell.mod(2.0), floor(cell.div(2.0))).mul(0.5));
      return world;
    })();
    const puff = texture(this.tex, vUV.add(uv().mul(0.5))).a;
    const sceneZ = perspectiveDepthToViewZ(viewportDepthTexture(), cameraNear, cameraFar);
    const soft = clamp(positionView.z.sub(sceneZ).div(1.2), 0, 1);
    const bg = viewportOpaqueMipTexture(screenUV, float(5.0)).rgb;
    mat.colorNode = vC.add(bg.mul(0.9));
    mat.opacityNode = clamp(puff.mul(vA).mul(soft), 0, 1);
    this.material = mat;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.count = this.N;
    mesh.frustumCulled = false;
    mesh.renderOrder = 9;
    mesh.name = 'weather.steam';
    this.mesh = mesh;
  }
}

// Emitter placement from the shared layout (+ buildings API when present). Deterministic.
export function steamEmitters(ctx) {
  const L = ctx.layout;
  const H = (x, z) => { try { const h = ctx.api.ground?.heightAt?.(x, z); return Number.isFinite(h) ? h : null; } catch { return null; } };
  const alleyY = (x) => {
    const h = H(x, L.alley.z); if (h !== null) return h;
    const s = L.alley.stairs; const t = Math.min(1, Math.max(0, (s.xStart - x) / (s.xStart - s.xEnd))); return t * s.rise;
  };
  const E = [];
  // street manholes / vents on the avenue
  for (const [x, z, s] of [[-2.6, 14, 1.0], [2.8, -24, 0.9], [-1.8, -52, 1.1], [3.2, -92, 0.9], [-3.0, -128, 1.0], [1.0, -170, 1.0]]) {
    E.push({ type: 0, pos: [x, (H(x, z) ?? 0) + 0.02, z], dir: [0, 1, 0], strength: 0.5 * s, size: 1.7, spread: 0.7, life: 5.0, speed: 1.5 });
  }
  // cross street vents
  for (const z of L.crossStreets.zs) E.push({ type: 0, pos: [-24, (H(-24, z) ?? 0) + 0.02, z + 1.5], dir: [0, 1, 0], strength: 0.3, size: 1.4, spread: 0.6, life: 4.5, speed: 1.3 });
  // ramen / shop exhaust: from facades on the avenue's west side near the street view, else layout guess
  const fac = ctx.api.buildings?.facades;
  let placed = 0;
  if (Array.isArray(fac)) {
    const shops = fac.filter((f) => f.shopfront && f.center && f.normal && (f.district === 'avenue' || f.district === 'alley'))
      .sort((a, b) => Math.abs(a.center.z - 5) - Math.abs(b.center.z - 5));
    const rng = mulberry32(99);
    for (const f of shops) {
      if (placed >= 3) break;
      if (rng() > 0.35) continue;
      const up = (f.floorHeight || 3.5) * 0.92;
      const off = (rng() - 0.5) * (f.width || 6) * 0.6;
      const p = [f.center.x + f.normal.x * 0.25 + f.right.x * off, up + (H(f.center.x, f.center.z) ?? 0), f.center.z + f.normal.z * 0.25 + f.right.z * off];
      E.push({ type: 1, pos: p, dir: [f.normal.x * 0.9, 0.6, f.normal.z * 0.9], strength: 0.4, size: 1.1, spread: 0.3, life: 3.5, speed: 1.6 });
      placed++;
    }
  }
  if (!placed) {
    E.push({ type: 1, pos: [-10.7, 3.3, 16], dir: [0.9, 0.6, 0], strength: 0.3, size: 0.9, spread: 0.3, life: 3.5, speed: 1.2 });
    E.push({ type: 1, pos: [10.7, 3.6, -36], dir: [-0.9, 0.6, 0], strength: 0.25, size: 0.9, spread: 0.3, life: 3.5, speed: 1.2 });
  }
  // alley: grates + vents along the alley, and low mist pooling
  for (const [x, s] of [[-18, 1], [-33, 0.8], [-47, 0.9], [-70, 1]]) {
    E.push({ type: 0, pos: [x, alleyY(x) + 0.02, L.alley.z + (x % 2 ? 1.2 : -1.2)], dir: [0, 1, 0], strength: 0.3 * s, size: 1.2, spread: 0.5, life: 4.0, speed: 1.1 });
  }
  for (let x = -14; x > -88; x -= 10) {
    E.push({ type: 2, pos: [x, alleyY(x) + 0.05, L.alley.z], strength: 0.10, size: 4.5, spread: 9, life: 9, speed: 0 });
  }
  // avenue low mist near ground (subtle)
  for (let z = 30; z > -200; z -= 22) E.push({ type: 2, pos: [0, 0.05, z], strength: 0.05, size: 6, spread: 16, life: 10, speed: 0 });
  // river mist
  const R = L.river;
  for (let z = 40; z > -320; z -= 18) {
    E.push({ type: 2, pos: [R.xCenter - R.halfWidth * 0.5, R.waterLevel + 0.15, z], strength: 0.12, size: 9, spread: 30, life: 12, speed: 0 });
    E.push({ type: 2, pos: [R.xCenter + R.halfWidth * 0.4, R.waterLevel + 0.15, z - 9], strength: 0.12, size: 9, spread: 30, life: 12, speed: 0 });
  }
  return E;
}
