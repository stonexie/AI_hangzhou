// Instanced renderer for every car in the game (hero, parked, traffic, expressway, flying, driven).
// One InstancedMesh per (type, lod, material) for bodies and wheels; matrices are rewritten each frame for the
// cars that pass CPU frustum culling, with distance-based LOD selection.
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildMaterialSet, PAINT_MATS, LIGHT_MATS } from './materials.js';

const _m = new THREE.Matrix4(), _w = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _c = new THREE.Color();
const _sphere = new THREE.Sphere(), _frustum = new THREE.Frustum(), _pm = new THREE.Matrix4();
const AX = new THREE.Vector3(1, 0, 0), AY = new THREE.Vector3(0, 1, 0);

export class Fleet {
  constructor(scene, models, capacity) {
    this.scene = scene; this.models = models;
    this.group = new THREE.Group(); this.group.name = 'vehicles_fleet';
    scene.add(this.group);
    this.sets = {}; // type -> lod -> { body: [{mesh, mat}], wheel: [{mesh}], n, cap }
    this.mats = {};
    this.lodDist = [16, 45, 110]; // < d0: LOD0, < d1: LOD1, < d2: LOD2, else LOD3
    this.maxLod0 = 4;
    for (const type in models) {
      const M = models[type];
      const mats = buildMaterialSet(type);
      this.mats[type] = mats;
      const cap = Math.max(1, capacity[type] || 0);
      this.sets[type] = M.lods.map((L, lod) => {
        const mk = (geom, matName, count) => {
          const mat = mats[matName] || mats.trim;
          const mesh = new THREE.InstancedMesh(geom, mat, count);
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
          if (PAINT_MATS.has(matName) || LIGHT_MATS.has(matName)) {
            mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3).fill(1), 3);
            mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
          }
          mesh.frustumCulled = false;
          mesh.count = 1; mesh.visible = true; // visible for the engine's compileAsync pre-pass (avoids pipeline hitches); real counts set each frame
          mesh.castShadow = false; mesh.receiveShadow = lod === 0;
          mesh.name = `veh_${type}_l${lod}_${matName}`;
          mesh.userData.matName = matName;
          this.group.add(mesh);
          return mesh;
        };
        return {
          body: L.parts.map((p) => mk(p.geom, p.mat, cap)),
          wheel: L.wheel.map((p) => mk(p.geom, p.mat, cap * 4)),
          n: 0, cap, slots: new Map(), seen: new Map(), free: [], hi: 0,
        };
      });
    }
    this.initSoloPool({ hero: 3, kei: 3, taxi: 3, van: 2, av: 1 });
  }

  // Hero / driven / nearest moving cars are rendered as regular meshes from a pool: correct per-object TRAA velocity
  // (InstancedMesh has none -> ghosting on fast cars), full LOD0 detail, per-car uniforms.
  makeSolo(type) {
    const M = this.models[type];
    const solo = { paint: uniform(new THREE.Color(1, 1, 1)), light: uniform(new THREE.Vector3(1, 1, 0)) };
    const mats = buildMaterialSet(type, solo);
    const g = new THREE.Group(); g.name = 'veh_solo_' + type;
    for (const p of M.lods[0].parts) {
      const m = new THREE.Mesh(p.geom, mats[p.mat] || mats.trim);
      m.receiveShadow = true; m.frustumCulled = false; g.add(m);
    }
    const wheels = M.slots.map(() => {
      const w = new THREE.Group();
      for (const p of M.lods[0].wheel) { const m = new THREE.Mesh(p.geom, mats[p.mat] || mats.trim); m.frustumCulled = false; w.add(m); }
      g.add(w); return w;
    });
    this.group.add(g);
    return { g, wheels, solo, mats, type, car: null };
  }

  initSoloPool(perType) {
    this.soloPool = {};
    for (const type in this.models) {
      const n = perType[type] ?? 3;
      this.soloPool[type] = Array.from({ length: n }, () => this.makeSolo(type));
    }
    this.soloMax = 7;
  }

  applySolo(S, c) {
    S.car = c; c._soloR = S;
    S.g.visible = true;
    S.g.position.copy(c.pos); S.g.quaternion.copy(c.quat);
    S.solo.paint.value.copy(c.paint);
    S.solo.light.value.copy(c.light);
    const M = this.models[c.type];
    M.slots.forEach((sl, w) => {
      const W = S.wheels[w];
      _q.setFromAxisAngle(AY, sl.front ? (c.steer || 0) : 0);
      _q2.setFromAxisAngle(AX, c.spin || 0);
      W.quaternion.copy(_q).multiply(_q2).multiply(sl.quat);
      W.position.copy(sl.pos); if (c.susp) W.position.y += c.susp[w] || 0;
    });
  }

  // cars: array of records { type, pos, quat, paint(Color), light(Vector3: head, tail, brake), spin, steer, visible, solo, radius }
  // Instance slots and solo renderers are STICKY per car: InstancedMesh motion vectors use the previous matrix of the
  // same instance index, so re-packing instances every frame would produce wrong velocities (TRAA ghosting).
  update(cars, camera) {
    this.frame = (this.frame || 0) + 1;
    const F = this.frame;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm, camera.coordinateSystem);
    const cp = camera.position;
    const list = this._list || (this._list = []);
    list.length = 0;
    for (const c of cars) {
      if (!this.sets[c.type] || c.visible === false) continue;
      c._d2 = cp.distanceToSquared(c.pos);
      if (!c.solo) {
        _sphere.center.copy(c.pos); _sphere.center.y += 0.8; _sphere.radius = c.radius || 3.5;
        if (!_frustum.intersectsSphere(_sphere)) continue;
      }
      list.push(c);
    }
    list.sort((a, b) => a._d2 - b._d2);
    // --- solo selection (sticky)
    let soloN = 0;
    const wantSolo = (c) => c.solo || (c.kind !== 'flying' && c._d2 < 30 * 30);
    for (const c of list) {
      if (!wantSolo(c)) continue;
      if (!c.solo && soloN >= this.soloMax) continue;
      if (c._soloR && c._soloR.car === c) { c._soloR.frame = F; if (!c.solo) soloN++; continue; }
      const pool = this.soloPool[c.type];
      let S = pool.find((x) => !x.car || x.frame !== F && !wantSolo(x.car));
      if (!S && c.solo) { S = this.makeSolo(c.type); pool.push(S); }
      if (!S) continue;
      if (S.car && S.car._soloR === S) S.car._soloR = null;
      S.car = c; c._soloR = S; S.frame = F; if (!c.solo) soloN++;
    }
    for (const type in this.soloPool) for (const S of this.soloPool[type]) {
      if (S.car && S.frame === F) this.applySolo(S, S.car);
      else { if (S.car && S.car._soloR === S) S.car._soloR = null; S.car = null; S.g.visible = false; }
    }
    // --- instanced
    for (const c of list) {
      if (c._soloR) continue;
      const d = Math.sqrt(c._d2);
      const ld = this.lodDist;
      const lod = c.forceLod ?? (d < ld[0] ? 0 : d < ld[1] ? 1 : d < ld[2] ? 2 : 3);
      const set = this.sets[c.type][lod];
      let i = set.slots.get(c);
      if (i === undefined) {
        if (set.free.length) i = set.free.pop();
        else if (set.hi < set.cap) i = set.hi++;
        else continue;
        set.slots.set(c, i);
      }
      set.seen.set(c, F);
      this.writeInstance(set, i, c);
    }
    for (const type in this.sets) for (const s of this.sets[type]) {
      for (const [c, i] of s.slots) {
        if (s.seen.get(c) !== F) { s.slots.delete(c); s.seen.delete(c); s.free.push(i); this.writeHidden(s, i); }
      }
      while (s.hi > 0 && s.free.includes(s.hi - 1)) { s.free.splice(s.free.indexOf(s.hi - 1), 1); s.hi--; }
      const n = s.hi;
      for (const mesh of s.body) {
        mesh.count = n; mesh.visible = n > 0;
        if (n) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; }
      }
      for (const mesh of s.wheel) {
        mesh.count = n * 4; mesh.visible = n > 0;
        if (n) mesh.instanceMatrix.needsUpdate = true;
      }
    }
    return list;
  }

  writeHidden(set, i) {
    _m.makeScale(0, 0, 0);
    for (const mesh of set.body) mesh.setMatrixAt(i, _m);
    for (const mesh of set.wheel) for (let w = 0; w < 4; w++) mesh.setMatrixAt(i * 4 + w, _m);
  }

  writeInstance(set, i, c) {
    _m.compose(c.pos, c.quat, _s);
    for (const mesh of set.body) {
      mesh.setMatrixAt(i, _m);
      if (mesh.instanceColor) {
        if (mesh.userData.matName === 'paint') mesh.setColorAt(i, c.paint);
        else { _c.setRGB(c.light.x, c.light.y, c.light.z); mesh.setColorAt(i, _c); }
      }
    }
    if (set.wheel.length) {
      const M = this.models[c.type];
      for (let w = 0; w < M.slots.length; w++) {
        const sl = M.slots[w];
        _q.setFromAxisAngle(AY, sl.front ? (c.steer || 0) : 0);
        _q2.setFromAxisAngle(AX, c.spin || 0);
        _q.multiply(_q2).multiply(sl.quat);
        _v.copy(sl.pos); if (c.susp) _v.y += c.susp[w] || 0;
        _w.compose(_v, _q, _s);
        _w.premultiply(_m);
        for (const mesh of set.wheel) mesh.setMatrixAt(i * 4 + w, _w);
      }
    }
  }
}
