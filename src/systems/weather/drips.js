// Drips & streams. Fully GPU: emitters are discovered in compute by searching the top-down heightfield for
// overhang edges (awnings, signs, roof edges, the elevated rail, car roofs...), so it adapts to whatever the other
// workstreams build.
//  - drips: each particle locks onto an edge point, a bead grows (hanging, glinting), detaches, falls, splashes, repeats.
//  - streams: groups of particles share one higher edge (gutter overflow / drain spout) and pour continuously.
import * as THREE from 'three/webgpu';
import {
  Fn, If, instancedArray, instanceIndex, float, vec2, vec3, vec4, uint, hash, select, mix, clamp, normalize, length,
  uv, smoothstep, abs, viewportOpaqueMipTexture, screenUV, varyingProperty, uniform, max, min, sin,
} from 'three/tsl';
import { U, makeLightFn, streakQuad, softClamp } from './common.js';
import { MAX_LIGHTS } from './lights.js';

export class Drips {
  constructor(ctx, { heightField, lights, splashes, drips = 6144, streamGroups = 14, perStream = 128 } = {}) {
    this.ctx = ctx;
    this.ND = drips; this.G = perStream; this.NSg = streamGroups;
    this.N = drips + streamGroups * perStream;
    this.hf = heightField; this.lights = lights; this.splashes = splashes;
    this.searchR = 26;
    this.lightGain = uniform(0.12);
    this.build();
  }

  build() {
    const { N, ND, G } = this;
    const hf = this.hf, splashes = this.splashes;
    const pos = (this.pos = instancedArray(N, 'vec4')); // xyz, radius
    const vel = (this.vel = instancedArray(N, 'vec4')); // xyz, hang timer (>0 hanging)
    const emit = (this.emit = instancedArray(N, 'vec4')); // xyz, w: 0 none, 1..4 edge dir index+1
    const col = (this.col = instancedArray(N, 'vec4')); // lit rgb, visible
    const SR = float(this.searchR);
    const dirOf = (w) => {
      const k = w.sub(1).round();
      return select(k.lessThan(0.5), vec2(1, 0), select(k.lessThan(1.5), vec2(-1, 0), select(k.lessThan(2.5), vec2(0, 1), vec2(0, -1))));
    };

    this.computeInit = Fn(() => {
      const i = instanceIndex;
      const fi = float(i);
      pos.element(i).assign(vec4(0, -1000, 0, 0.001));
      const isStream = i.greaterThanEqual(uint(ND));
      const k = float(i.sub(uint(ND)).mod(uint(G)));
      vel.element(i).assign(vec4(0, 0, 0, select(isStream, k.div(G).mul(2.2), hash(fi.mul(3.3)).mul(3.0))));
      emit.element(i).assign(vec4(0, 0, 0, 0));
      col.element(i).assign(vec4(0));
    })().compute(N).setName('dripInit');

    const lightAt = makeLightFn(this.lights, MAX_LIGHTS, { g: 0.7, iso: 0.25 });

    this.computeUpdate = Fn(() => {
      const i = instanceIndex;
      const fi = float(i);
      const isStream = i.greaterThanEqual(uint(ND));
      const leader = select(isStream, i.sub(i.sub(uint(ND)).mod(uint(G))), i);
      const isLeader = leader.equal(i);
      const E = emit.element(i).toVar();
      // ---- emitter search / validation ----
      If(isLeader, () => {
        If(E.w.greaterThan(0.5).and(length(E.xz.sub(U.cam.xz)).greaterThan(SR.mul(1.3))), () => { E.w.assign(0); });
        If(E.w.lessThan(0.5), () => {
          const a = hash(fi.mul(1.37).add(U.frame.mul(0.1234)).add(0.3));
          const b = hash(fi.mul(2.71).add(U.frame.mul(0.3141)).add(7.7));
          const rr = select(isStream, SR.mul(1.1), SR);
          const c = U.cam.xz.add(vec2(a, b).sub(0.5).mul(rr.mul(2)));
          const h0 = hf.sample(c).toVar();
          const minDrop = select(isStream, float(3.5), float(1.0));
          const okH = h0.greaterThan(select(isStream, float(4.0), float(1.4))).and(h0.lessThan(select(isStream, float(26.0), U.cam.y.add(22.0))));
          // stochastic preference for low edges (awnings/signs) for drips
          const lowPref = select(isStream, float(1), select(h0.lessThan(9.0), float(1), float(0.25)));
          If(okH.and(hash(fi.add(U.frame.mul(0.77))).lessThan(lowPref)), () => {
            const found = float(0).toVar();
            const fp = vec3(0).toVar();
            const tryDir = (d, idx) => {
              If(found.lessThan(0.5), () => {
                const h1 = hf.sample(c.add(d.mul(0.45)));
                If(h0.sub(h1).greaterThan(minDrop), () => {
                  // refine edge position
                  const hm = hf.sample(c.add(d.mul(0.22)));
                  const off = select(h0.sub(hm).greaterThan(minDrop), float(0.16), float(0.36));
                  const q = c.add(d.mul(off));
                  fp.assign(vec3(q.x, h0.sub(0.03), q.y));
                  found.assign(float(idx));
                });
              });
            };
            tryDir(vec2(1, 0), 1); tryDir(vec2(-1, 0), 2); tryDir(vec2(0, 1), 3); tryDir(vec2(0, -1), 4);
            If(found.greaterThan(0.5), () => { E.assign(vec4(fp, found)); });
          });
        });
        emit.element(i).assign(E);
      });
      If(isLeader.not(), () => { E.assign(emit.element(leader)); });

      const P = pos.element(i).toVar();
      const V = vel.element(i).toVar();
      const seed = hash(fi.mul(0.917).add(4.1));
      const visible = float(0).toVar();
      If(E.w.lessThan(0.5), () => {
        P.assign(vec4(0, -1000, 0, 0.001));
      }).Else(() => {
        If(V.w.greaterThan(0), () => {
          // hanging at the edge
          V.w.subAssign(U.dt);
          const grow = clamp(float(1).sub(V.w.div(2.0)), 0.25, 1.0);
          P.assign(vec4(E.xyz.sub(vec3(0, grow.mul(0.004), 0)), select(isStream, float(0), mix(float(0.0008), float(0.0026), grow))));
          V.xyz.assign(vec3(0));
          If(V.w.lessThanEqual(0), () => {
            // detach
            const d = dirOf(E.w);
            const push = select(isStream, hash(fi.add(U.frame)).mul(0.35).add(0.45), float(0.02));
            V.xyz.assign(vec3(d.x.mul(push), select(isStream, float(-0.3), float(-0.4)), d.y.mul(push)));
            P.w.assign(select(isStream, mix(float(0.0025), float(0.0055), seed), mix(float(0.0018), float(0.003), seed)));
          });
          visible.assign(select(isStream, float(0), float(1)));
        }).Else(() => {
          // falling
          V.y.subAssign(U.dt.mul(9.81));
          V.x.assign(mix(V.x, U.wind.x.mul(0.35), U.dt.mul(0.4)));
          V.z.assign(mix(V.z, U.wind.y.mul(0.35), U.dt.mul(0.4)));
          // streams break up as they fall
          const jit = select(isStream, float(0.6), float(0.05));
          V.x.addAssign(sin(U.time.mul(13.0).add(seed.mul(50.0))).mul(jit).mul(U.dt));
          V.z.addAssign(sin(U.time.mul(11.0).add(seed.mul(37.0))).mul(jit).mul(U.dt));
          const prevY = P.y;
          P.xyz.addAssign(V.xyz.mul(U.dt));
          const h = hf.sample(P.xz);
          visible.assign(1);
          If(P.y.lessThan(h).or(P.y.lessThan(U.cam.y.sub(40))), () => {
            If(P.y.greaterThan(h.sub(0.6)).and(length(P.xz.sub(U.cam.xz)).lessThan(30.0)), () => {
              splashes.emit(fi.add(U.frame.mul(0.381)).add(1000.0), vec3(P.x, h, P.z), col.element(i).xyz, P.w.mul(select(isStream, float(1.6), float(1.3))), V.xyz);
            });
            P.assign(vec4(E.xyz, 0));
            V.assign(vec4(0, 0, 0, select(isStream, hash(fi.add(U.frame.mul(0.5))).mul(0.03), mix(float(0.5), float(3.5), hash(fi.add(U.frame.mul(0.13)))))));
            visible.assign(0);
          });
        });
      });
      pos.element(i).assign(P);
      vel.element(i).assign(V);
      const vd = normalize(U.cam.sub(P.xyz));
      const lit = softClamp(lightAt(P.xyz, vd).mul(this.lightGain), 0.3);
      col.element(i).assign(vec4(U.ambient.add(lit).add(vec3(0.55, 0.6, 0.75).mul(U.lightning.mul(2.5))), visible));
    })().compute(N).setName('dripUpdate');

    // ---- render ----
    const P4 = pos.toAttribute(), V4 = vel.toAttribute(), C4 = col.toAttribute();
    const vA = varyingProperty('float', 'vDripA');
    const vC = varyingProperty('vec3', 'vDripC');
    const mat = new THREE.MeshBasicNodeMaterial();
    mat.transparent = true; mat.depthWrite = false; mat.side = THREE.DoubleSide; mat.fog = true;
    mat.positionNode = Fn(() => {
      const isStream = instanceIndex.greaterThanEqual(uint(ND));
      const T = select(isStream, float(0.07), float(0.045));
      const q = streakQuad(P4.xyz, V4.xyz.sub(U.camVel.mul(0.7)).mul(T), P4.w.max(0.0003), 0.8);
      const hanging = V4.w.greaterThan(0);
      const distFade = float(1).sub(smoothstep(22.0, 34.0, q.dist));
      const a = q.coverage.mul(C4.w).mul(distFade).mul(select(isStream, float(0.85), select(hanging, float(1.0), float(0.8))));
      vA.assign(a.mul(U.rain.mul(0.8).add(0.2)));
      vC.assign(C4.xyz.mul(select(hanging, float(3.0), float(1.6))));
      return q.world;
    })();
    const u = uv();
    const across = float(1).sub(abs(u.x.mul(2).sub(1)));
    const along = smoothstep(0.0, 0.2, u.y).mul(smoothstep(1.0, 0.85, u.y));
    const bg = viewportOpaqueMipTexture(screenUV, float(4.0)).rgb;
    mat.colorNode = vC.add(bg.mul(1.6));
    mat.opacityNode = clamp(vA.mul(across.mul(across).mul(1.4)).mul(along), 0, 1);
    this.material = mat;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    mesh.count = N;
    mesh.frustumCulled = false;
    mesh.renderOrder = 12;
    mesh.name = 'weather.drips';
    this.mesh = mesh;
  }

  init(renderer) { renderer.compute(this.computeInit); }
  update(renderer) { renderer.compute(this.computeUpdate); }
}
