// GPU compute rain: two populations (near big streaks, far fine sheets) in camera-following wrap volumes.
// Each drop: position+radius, velocity+seed, lit colour (computed per drop in compute from nearby lights).
// Drops collide against the top-down heightfield and emit splashes into a shared ring buffer.
import * as THREE from 'three/webgpu';
import {
  Fn, If, instancedArray, instanceIndex, float, vec3, vec4, uint, hash, select, mix, exp, sin, clamp,
  normalize, length, uv, smoothstep, abs, viewportOpaqueMipTexture, screenUV, varyingProperty, uniform,
} from 'three/tsl';
import { U, fmod, makeLightFn, streakQuad, softClamp } from './common.js';
import { MAX_LIGHTS } from './lights.js';

export class Rain {
  constructor(ctx, { heightField, lights, splashes, nearCount = 32768, midCount = 163840, farCount = 131072 } = {}) {
    this.ctx = ctx;
    this.N1 = nearCount; this.N2 = midCount; this.N3 = farCount; this.N = nearCount + midCount + farCount;
    this.hf = heightField; this.lights = lights; this.splashes = splashes;
    this.params = { nearR: 12, nearTop: 9, nearBot: 5, midR: 34, midTop: 20, midBot: 12, farR: 85, farTop: 32, farBot: 32 };
    this.streakT = uniform(0.038);
    this.opacity = uniform(0.52);
    this.lightGain = uniform(0.08);
    this.ambGain = uniform(1.8);
    this.bgGain = uniform(1.3);
    this.build();
  }

  build() {
    const { N, N1, N2 } = this;
    const P = this.params;
    this.pos = instancedArray(N, 'vec4'); // xyz, radius
    this.vel = instancedArray(N, 'vec4'); // xyz, seed
    this.col = instancedArray(N, 'vec4'); // rgb lit colour, alpha factor
    const pos = this.pos, vel = this.vel, col = this.col;
    const hf = this.hf;
    const splashes = this.splashes;

    const layer = (i) => {
      const near = i.lessThan(uint(N1));
      const mid = i.lessThan(uint(N1 + N2));
      const pick = (a, b, c) => select(near, float(a), select(mid, float(b), float(c)));
      return { near, mid, R: pick(P.nearR, P.midR, P.farR), top: pick(P.nearTop, P.midTop, P.farTop), bot: pick(P.nearBot, P.midBot, P.farBot), A: pick(0.8, 0.6, 0.45) };
    };
    const termSpeed = (radius) => clamp(radius.mul(2600).add(3.2), 3.5, 9.5);

    this.computeInit = Fn(() => {
      const i = instanceIndex;
      const fi = float(i);
      const { near, R, top, bot } = layer(i);
      const r1 = hash(fi.mul(1.731).add(0.5)), r2 = hash(fi.mul(2.917).add(11.3)), r3 = hash(fi.mul(0.613).add(71.9)), r4 = hash(fi.mul(5.11).add(3.7));
      const radius = select(near, mix(float(0.0009), float(0.0024), r4.mul(r4)), mix(float(0.0006), float(0.0016), r4));
      const p = vec3(U.cam.x.add(r1.sub(0.5).mul(R.mul(2))), U.cam.y.sub(bot).add(r2.mul(top.add(bot))), U.cam.z.add(r3.sub(0.5).mul(R.mul(2))));
      pos.element(i).assign(vec4(p, radius));
      vel.element(i).assign(vec4(U.wind.x, termSpeed(radius).negate(), U.wind.y, hash(fi.mul(9.13).add(1.1))));
      col.element(i).assign(vec4(0, 0, 0, 1));
    })().compute(N).setName('rainInit');

    const lightAt = makeLightFn(this.lights, MAX_LIGHTS, { g: 0.75, iso: 0.18 });

    this.computeUpdate = Fn(() => {
      const i = instanceIndex;
      const fi = float(i);
      const { R, top, bot } = layer(i);
      const P4 = pos.element(i), V4 = vel.element(i);
      const p = P4.xyz.toVar();
      const v = V4.xyz.toVar();
      const radius = P4.w.toVar();
      const seed = V4.w.toVar();
      const term = termSpeed(radius);
      // gusts: global multiplier + travelling spatial wave
      const wave = sin(U.time.mul(0.9).add(p.x.mul(0.045)).add(p.z.mul(0.031))).mul(0.5)
        .add(sin(U.time.mul(2.3).add(p.z.mul(0.13)).add(seed.mul(6.28))).mul(0.2));
      const g = U.gust.mul(wave.mul(0.35).add(1.0));
      const flutter = vec3(sin(U.time.mul(7.0).add(seed.mul(40.0))), 0, sin(U.time.mul(6.1).add(seed.mul(31.0)))).mul(0.25);
      const target = vec3(U.wind.x.mul(g), term.negate(), U.wind.y.mul(g)).add(flutter).toVar();
      v.assign(mix(v, target, float(1).sub(exp(U.dt.mul(-3.0)))));
      const prevY = p.y.toVar();
      p.addAssign(v.mul(U.dt));
      // horizontal wrap around the camera
      const rel = fmod(p.xz.sub(U.cam.xz).add(R), R.mul(2)).sub(R).toVar();
      p.x.assign(U.cam.x.add(rel.x));
      p.z.assign(U.cam.z.add(rel.y));
      // vertical wrap (camera moved)
      If(p.y.greaterThan(U.cam.y.add(top)), () => { p.y.subAssign(top.add(bot)); prevY.assign(p.y.add(1)); });
      If(p.y.lessThan(U.cam.y.sub(bot)), () => { p.y.addAssign(top.add(bot)); prevY.assign(p.y.add(1)); });
      const h = hf.sample(p.xz).toVar();
      If(p.y.lessThan(h), () => {
        // impact -> splash (only for drops that actually fell onto the surface and are near enough to matter)
        const dxz = length(p.xz.sub(U.cam.xz));
        const LYs = layer(i);
        const want = select(LYs.near, dxz.lessThan(16.0), LYs.mid.and(dxz.lessThan(24.0)).and(hash(fi.add(U.frame.mul(0.31))).lessThan(0.45)));
        If(prevY.greaterThanEqual(h.sub(0.3)).and(want).and(h.greaterThan(-50)), () => {
          splashes.emit(fi.add(U.frame.mul(0.6180339)), vec3(p.x, h, p.z), col.element(i).xyz, radius, vec3(v.x, 0, v.z));
        });
        const r1 = hash(fi.add(U.frame.mul(1.618)).add(seed)), r2 = hash(fi.mul(1.3).add(U.frame.mul(2.718)).add(7.0)), r3 = hash(fi.mul(0.7).add(U.frame.mul(0.577)).add(3.0));
        p.assign(vec3(U.cam.x.add(r1.sub(0.5).mul(R.mul(2))), U.cam.y.add(top).sub(r3.mul(2.0)), U.cam.z.add(r2.sub(0.5).mul(R.mul(2)))));
        v.assign(target);
      });
      pos.element(i).assign(vec4(p, radius));
      vel.element(i).assign(vec4(v, seed));
      // lighting (per drop, once per frame)
      const vd = normalize(U.cam.sub(p));
      const lit = softClamp(lightAt(p, vd).mul(this.lightGain), 0.25);
      const c = U.ambient.mul(this.ambGain).add(vec3(0.05, 0.056, 0.072)).add(lit).add(vec3(0.55, 0.6, 0.75).mul(U.lightning.mul(2.5)));
      col.element(i).assign(vec4(c, 1));
    })().compute(N).setName('rainUpdate');

    // ---------- render: velocity-oriented camera-facing streak quads ----------
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true;
    mat.depthWrite = false;
    mat.depthTest = true;
    mat.side = THREE.DoubleSide;
    mat.fog = true;
    const vAlpha = varyingProperty('float', 'vRainAlpha');
    const vCol = varyingProperty('vec3', 'vRainCol');
    const P4a = pos.toAttribute(), V4a = vel.toAttribute(), C4a = col.toAttribute();
    const streakT = this.streakT;
    mat.positionNode = Fn(() => {
      const head = P4a.xyz;
      const radius = P4a.w;
      const relV = V4a.xyz.sub(U.camVel.mul(0.7));
      const { world, coverage, dist } = streakQuad(head, relV.mul(streakT), radius, 0.75);
      const nearFade = smoothstep(0.35, 1.2, dist);
      const LY = layer(instanceIndex);
      const R = LY.R;
      const hd = length(head.xz.sub(U.cam.xz)).div(R);
      const edgeFade = float(1).sub(smoothstep(0.75, 1.0, hd));
      const layerA = LY.A;
      vAlpha.assign(coverage.pow(0.6).mul(nearFade).mul(edgeFade).mul(layerA).mul(U.rain));
      const sd = V4a.w;
      const glint = sd.mul(sd).mul(sd).mul(1.4).add(0.6);
      vCol.assign(C4a.xyz.mul(glint));
      return world;
    })();
    const bg = viewportOpaqueMipTexture(screenUV, float(5.5)).rgb;
    const u = uv();
    const across = float(1).sub(abs(u.x.mul(2).sub(1)));
    const along = smoothstep(0.0, 0.25, u.y).mul(smoothstep(1.0, 0.8, u.y)).mul(u.y.mul(0.5).add(0.5));
    mat.colorNode = vCol.add(bg.mul(this.bgGain));
    mat.opacityNode = vAlpha.mul(across.mul(across)).mul(along).mul(this.opacity);
    this.material = mat;

    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1, 1, 1), mat);
    mesh.count = N;
    mesh.frustumCulled = false;
    mesh.renderOrder = 10;
    mesh.name = 'weather.rain';
    this.mesh = mesh;
  }

  init(renderer) { renderer.compute(this.computeInit); }
  update(renderer) { renderer.compute(this.computeUpdate); }
}
