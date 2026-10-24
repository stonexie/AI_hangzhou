import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();

// Collects transformed geometries per material key, then merges them into chunked meshes.
export class Batch {
  constructor() { this.parts = new Map(); }
  add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
    _m.compose(_p, _q, _s);
    const g = geo.clone().applyMatrix4(_m);
    if (g.index) { const ng = g.toNonIndexed(); g.dispose(); this._push(key, ng); } else this._push(key, g);
    return this;
  }
  addMatrix(key, geo, matrix) {
    const g = geo.clone().applyMatrix4(matrix);
    this._push(key, g.index ? g.toNonIndexed() : g);
  }
  box(key, w, h, d, x, y, z, ry = 0, rx = 0, rz = 0) {
    return this.add(key, unitBox, x, y, z, rx, ry, rz, w, h, d);
  }
  _push(key, g) {
    for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!this.parts.has(key)) this.parts.set(key, []);
    this.parts.get(key).push(g);
  }
  // Build meshes. materials: { key: material }. uvMode per key: 'world' (box-projected, meters/scale) or 'keep'.
  build(materials, { worldUV = {}, chunk = 0, castShadow = false, receiveShadow = true } = {}) {
    const group = new THREE.Group();
    for (const [key, list] of this.parts) {
      const mat = materials[key];
      if (!mat) { console.warn('[landmarks] no material for', key); continue; }
      let buckets = new Map();
      if (chunk > 0) {
        for (const g of list) {
          g.computeBoundingBox();
          const c = g.boundingBox.getCenter(_p);
          const k = Math.floor(c.x / chunk) + ':' + Math.floor(c.z / chunk);
          if (!buckets.has(k)) buckets.set(k, []);
          buckets.get(k).push(g);
        }
      } else buckets.set('all', list);
      for (const arr of buckets.values()) {
        const merged = mergeGeometries(arr, false);
        if (!merged) continue;
        if (worldUV[key]) boxProjectUV(merged, worldUV[key]);
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        const mesh = new THREE.Mesh(merged, mat);
        mesh.castShadow = castShadow; mesh.receiveShadow = receiveShadow;
        mesh.name = 'lm_' + key;
        mesh.matrixAutoUpdate = false;
        group.add(mesh);
      }
    }
    return group;
  }
}

export const unitBox = new THREE.BoxGeometry(1, 1, 1);

// Box-projected world UVs: u/v in meters / scale, chosen by dominant normal axis.
export function boxProjectUV(geo, scale = 1) {
  const pos = geo.attributes.position, nor = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nor.getX(i)), ny = Math.abs(nor.getY(i)), nz = Math.abs(nor.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z * Math.sign(nor.getX(i) || 1); v = y; }
    else { u = -x * Math.sign(nor.getZ(i) || 1); v = y; }
    uv[i * 2] = u / scale; uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

// Trapezoid / arbitrary profile (in local Y-Z plane, points [z,y]) extruded along X from x0 to x1.
export function profileGeometry(points, x0, x1) {
  const shape = new THREE.Shape(points.map(([z, y]) => new THREE.Vector2(z, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: x1 - x0, bevelEnabled: false, steps: 1 });
  // shape is in XY, extruded along +Z; map shape.x -> world z, shape.y -> y, extrude -> world x
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0));
  g.applyMatrix4(m);
  g.translate(x0, 0, 0);
  // basis swap flips handedness -> fix winding
  flipWinding(g);
  return g;
}

export function flipWinding(g) {
  if (g.index) {
    const a = g.index.array;
    for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; }
    g.index.needsUpdate = true;
  } else {
    for (const name of Object.keys(g.attributes)) {
      const at = g.attributes[name], s = at.itemSize, arr = at.array;
      for (let i = 0; i < at.count; i += 3) {
        for (let k = 0; k < s; k++) { const t = arr[(i + 1) * s + k]; arr[(i + 1) * s + k] = arr[(i + 2) * s + k]; arr[(i + 2) * s + k] = t; }
      }
      at.needsUpdate = true;
    }
  }
  g.computeVertexNormals();
}

// Thin box between two points (for wires, rails, beams)
export function beamBetween(batch, key, a, b, w, h) {
  const d = new THREE.Vector3().subVectors(b, a);
  const len = d.length();
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize());
  const m = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(len, h, w));
  batch.addMatrix(key, unitBox, m);
}

// Static Rapier cuboid collider (center + half extents, optional yaw)
export function cuboid(ctx, cx, cy, cz, hx, hy, hz, yaw = 0) {
  const { RAPIER, world } = ctx.physics || {};
  if (!world) return;
  const desc = RAPIER.ColliderDesc.cuboid(Math.max(0.01, hx), Math.max(0.01, hy), Math.max(0.01, hz)).setTranslation(cx, cy, cz);
  if (yaw) { const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw); desc.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }); }
  world.createCollider(desc);
}
export function cuboidRot(ctx, cx, cy, cz, hx, hy, hz, quat) {
  const { RAPIER, world } = ctx.physics || {};
  if (!world) return;
  const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz).setTranslation(cx, cy, cz).setRotation({ x: quat.x, y: quat.y, z: quat.z, w: quat.w });
  world.createCollider(desc);
}
export function cylinderCol(ctx, cx, cy, cz, halfH, r) {
  const { RAPIER, world } = ctx.physics || {};
  if (!world) return;
  world.createCollider(RAPIER.ColliderDesc.cylinder(halfH, r).setTranslation(cx, cy, cz));
}

export function groundY(ctx, x, z) {
  const h = ctx.api.ground?.heightAt?.(x, z);
  return Number.isFinite(h) ? h : 0;
}
