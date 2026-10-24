// Vehicle lighting: pooled red tail PointLights + warm head PointLights for the nearest cars (wet-road reflections),
// fake additive headlight beams + ground pools for all ground cars (instanced), blinking nav lights for flying AVs,
// and real SpotLights (no shadows) for the hero / driven car.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uv, smoothstep, length, mix, clamp, instanceIndex, time, fract, sin, step, positionGeometry, abs,
  normalView, positionView, normalize, dot, pow, instanceColor, max, hash, cameraPosition, positionWorld,
} from 'three/tsl';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _s1 = new THREE.Vector3(1, 1, 1);

export class VehicleLights {
  constructor(scene, models, { tailCount = 28, headCount = 14, beamCap = 220, navCap = 200 } = {}) {
    this.scene = scene; this.models = models;
    this.group = new THREE.Group(); this.group.name = 'vehicle_lights'; scene.add(this.group);
    this.tail = [];
    for (let i = 0; i < tailCount; i++) {
      const l = new THREE.PointLight(0xff1208, 0, 7, 2);
      l.castShadow = false; this.group.add(l); this.tail.push(l);
    }
    this.head = [];
    for (let i = 0; i < headCount; i++) {
      const l = new THREE.PointLight(0xffe2c0, 0, 16, 2);
      l.castShadow = false; this.group.add(l); this.head.push(l);
    }
    // --- headlight beams: two cones per car merged into one geometry, apex at the lamps, opening forward (-Z)
    const cone = (x) => {
      const g = new THREE.ConeGeometry(2.4, 14, 20, 1, true);
      g.translate(0, -7, 0);                 // apex at origin, extends to -Y
      g.rotateX(-Math.PI / 2);               // -> extends to -Z
      g.rotateX(-0.06);                       // slightly down
      g.translate(x, 0, 0);
      return g;
    };
    const merge = (a, b) => {
      const g = new THREE.BufferGeometry();
      const pa = a.getAttribute('position').array, pb = b.getAttribute('position').array;
      const ua = a.getAttribute('uv').array, ub = b.getAttribute('uv').array;
      g.setAttribute('position', new THREE.Float32BufferAttribute([...pa, ...pb], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([...ua, ...ub], 2));
      const ia = Array.from(a.index.array), ib = Array.from(b.index.array).map((i) => i + pa.length / 3);
      g.setIndex([...ia, ...ib]);
      g.computeVertexNormals();
      return g;
    };
    const beamGeo = merge(cone(-0.62), cone(0.62));
    const bm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    bm.fog = false;
    // uv.y: 1 at apex .. 0 at far end (ConeGeometry v runs base->tip). fade along length + edge fresnel + distance
    const along = uv().y;
    const nv = normalize(normalView);
    const vdir = normalize(positionView).negate();
    const edge = pow(clamp(abs(dot(nv, vdir)), 0, 1), 1.6);
    const camD = length(positionWorld.sub(cameraPosition));
    const distFade = smoothstep(260.0, 60.0, camD).mul(smoothstep(1.5, 6.0, camD));
    bm.colorNode = vec3(1.0, 0.88, 0.72).mul(along.pow(2.2)).mul(edge).mul(distFade).mul(instanceColor.x).mul(0.016);
    this.beams = new THREE.InstancedMesh(beamGeo, bm, beamCap);
    this.beams.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(beamCap * 3).fill(1), 3);
    this.beams.frustumCulled = false; this.beams.count = 0; this.beams.renderOrder = 5;
    this.group.add(this.beams);
    // --- ground pools: subtle additive ellipse decal on the road ahead of each car
    const poolGeo = new THREE.PlaneGeometry(5.5, 11).rotateX(-Math.PI / 2).translate(0, 0.03, -7.5);
    const pm = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    pm.fog = false;
    const pu = uv().sub(vec2(0.5, 0.15)).mul(vec2(2.0, 1.1));
    const pf = smoothstep(1.0, 0.0, length(pu)).pow(1.8);
    const pd = length(positionWorld.sub(cameraPosition));
    pm.colorNode = vec3(1.0, 0.88, 0.7).mul(pf).mul(smoothstep(220.0, 40.0, pd)).mul(instanceColor.x).mul(0.045);
    pm.polygonOffset = true; pm.polygonOffsetFactor = -2;
    this.pools = new THREE.InstancedMesh(poolGeo, pm, beamCap);
    this.pools.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(beamCap * 3).fill(1), 3);
    this.pools.frustumCulled = false; this.pools.count = 0; this.pools.renderOrder = 4;
    this.group.add(this.pools);
    // --- Drone nav lights (3 per quadcopter drone: red left, green right, white tail)
    const navGeo = new THREE.SphereGeometry(0.055, 8, 6);
    const nm = new THREE.MeshBasicNodeMaterial();
    const ph = hash(instanceIndex.div(3).toFloat().add(0.5));
    const kind = instanceIndex.mod(3).toFloat();
    const blinkRG = step(0.55, fract(time.mul(0.9).add(ph)));
    const strobe = step(0.92, fract(time.mul(1.3).add(ph.mul(3.0))));
    const k = mix(float(0.35).add(blinkRG.mul(0.65)), strobe, step(1.5, kind));
    nm.colorNode = instanceColor.mul(k).mul(8.0);
    this.nav = new THREE.InstancedMesh(navGeo, nm, navCap * 3);
    this.nav.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(navCap * 9), 3);
    this.nav.frustumCulled = false; this.nav.count = 0;
    this.group.add(this.nav);
    this.navCap = navCap;
    // --- hero / driven car spotlights (2 total, no shadows)
    this.spots = [];
    for (let i = 0; i < 2; i++) {
      const s = new THREE.SpotLight(0xfff0dc, 0, 55, 0.42, 0.55, 1.6);
      s.castShadow = false;
      this.group.add(s); this.group.add(s.target);
      this.spots.push(s);
    }
  }

  // ground: visible ground cars (from fleet.update list, sorted by distance). sky: flying cars. spotCar: car with real headlights
  update(ground, all, sky, camera, spotCar) {
    const cp = camera.position;
    // tail + head point lights for nearest lit cars
    let ti = 0, hi = 0;
    for (const c of ground) {
      if (c.kind === 'flying') continue;
      const M = this.models[c.type];
      if (!M) continue;
      const d2 = c._d2 ?? cp.distanceToSquared(c.pos);
      if (d2 > 140 * 140) break;
      if (ti < this.tail.length && c.light.y > 0) {
        const l = this.tail[ti++];
        _v.set(0, 0.3, M.length * 0.5 + 1.5).applyQuaternion(c.quat).add(c.pos);
        l.position.copy(_v);
        l.intensity = (0.9 + c.light.z * 2.5) * c.light.y;
      }
      if (hi < this.head.length && c.light.x > 0 && c !== spotCar) {
        const l = this.head[hi++];
        _v.set(0, 0.7, -M.length * 0.5 - 2.6).applyQuaternion(c.quat).add(c.pos);
        l.position.copy(_v);
        l.intensity = 9 * c.light.x;
      }
    }
    for (; ti < this.tail.length; ti++) this.tail[ti].intensity = 0;
    for (; hi < this.head.length; hi++) this.head[hi].intensity = 0;
    // beams + pools for all lit ground cars in the visible list
    let bi = 0;
    for (const c of ground) {
      if (c.kind === 'flying' || c.kind === 'parked' || c.light.x <= 0) continue;
      if (bi >= this.beams.instanceMatrix.count) break;
      const M = this.models[c.type];
      // fade the volumetric cone when we look into it (seen head-on it reads as a blob, not a beam)
      _v2.set(0, 0, -1).applyQuaternion(c.quat);
      _v.subVectors(cp, c.pos).normalize();
      const facing = Math.max(0, _v2.dot(_v));
      const beamK = c.light.x * Math.pow(1 - facing, 3);
      _v.set(0, M.height * 0.42 + 0.05, -M.length * 0.5 + 0.1).applyQuaternion(c.quat).add(c.pos);
      _m.compose(_v, c.quat, _s1);
      this.beams.setMatrixAt(bi, _m);
      this.beams.instanceColor.setXYZ(bi, beamK, 0, 0);
      _v.set(0, 0, -M.length * 0.5).applyQuaternion(c.quat).add(c.pos);
      _m.compose(_v, c.quat, _s1);
      this.pools.setMatrixAt(bi, _m);
      this.pools.instanceColor.setXYZ(bi, c.light.x, 0, 0);
      bi++;
    }
    this.beams.count = bi; this.pools.count = bi;
    this.beams.instanceMatrix.needsUpdate = true; this.beams.instanceColor.needsUpdate = true;
    this.pools.instanceMatrix.needsUpdate = true; this.pools.instanceColor.needsUpdate = true;
    // nav lights on quadcopter drone arms
    let ni = 0;
    const cols = [[1, 0.08, 0.05], [0.08, 1, 0.35], [0.9, 0.95, 1]];
    const offs = [[-0.62, 0.46, -0.62], [0.62, 0.46, -0.62], [0, 0.48, 0.36]];
    for (const c of sky) {
      if (ni >= this.navCap) break;
      for (let k = 0; k < 3; k++) {
        _v.set(...offs[k]).applyQuaternion(c.quat).add(c.pos);
        _m.makeTranslation(_v.x, _v.y, _v.z);
        const sc = 1.0;
        _m.scale(_v2.set(sc, sc, sc));
        this.nav.setMatrixAt(ni * 3 + k, _m);
        this.nav.instanceColor.setXYZ(ni * 3 + k, ...cols[k]);
      }
      ni++;
    }
    this.nav.count = ni * 3;
    this.nav.instanceMatrix.needsUpdate = true; this.nav.instanceColor.needsUpdate = true;
    // spots
    for (let i = 0; i < 2; i++) {
      const s = this.spots[i];
      if (!spotCar || spotCar.light.x <= 0) { s.intensity = 0; continue; }
      const M = this.models[spotCar.type];
      const x = i ? 0.62 : -0.62;
      s.position.set(x, M.height * 0.42, -M.length * 0.5 - 0.05).applyQuaternion(spotCar.quat).add(spotCar.pos);
      s.target.position.set(x * 1.6, -0.4, -M.length * 0.5 - 22).applyQuaternion(spotCar.quat).add(spotCar.pos);
      s.intensity = 260 * spotCar.light.x;
    }
  }
}
