import * as THREE from 'three/webgpu';

// Growable geometry bucket. All quads/boxes are emitted with position, normal, tangent, uv + custom vec4 attributes.
// One bucket = one material in one chunk => one draw call.
export class Bucket {
  constructor(attrDefs = {}) {
    this.attrDefs = attrDefs; // { name: defaultArray(4) }
    this.pos = []; this.nrm = []; this.tan = []; this.uv = []; this.idx = [];
    this.attrs = {};
    for (const k in attrDefs) this.attrs[k] = [];
    this.count = 0;
  }

  _pushVert(p, n, t, uv, a) {
    this.pos.push(p[0], p[1], p[2]);
    this.nrm.push(n[0], n[1], n[2]);
    this.tan.push(t[0], t[1], t[2], 1);
    this.uv.push(uv[0], uv[1]);
    for (const k in this.attrDefs) {
      const v = (a && a[k]) || this.attrDefs[k];
      this.attrs[k].push(v[0], v[1], v[2], v[3]);
    }
    return this.count++;
  }

  // Quad: corners p0..p3 counter-clockwise seen from the front (normal side). uvs per corner.
  quad(p0, p1, p2, p3, uv0, uv1, uv2, uv3, a, n = null, t = null) {
    if (!n) {
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2 = [p3[0] - p0[0], p3[1] - p0[1], p3[2] - p0[2]];
      n = norm(cross(e1, e2));
    }
    if (!t) t = norm([p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]]);
    const i0 = this._pushVert(p0, n, t, uv0, a);
    this._pushVert(p1, n, t, uv1, a);
    this._pushVert(p2, n, t, uv2, a);
    this._pushVert(p3, n, t, uv3, a);
    this.idx.push(i0, i0 + 1, i0 + 2, i0, i0 + 2, i0 + 3);
  }

  // Vertical rectangle on a facade plane. origin = bottom-left world point, right = unit horizontal vector,
  // width/height in meters. UV = (u0 + s, v0 + t) in meters (facade space). Normal = up x right... computed.
  vrect(origin, right, w, h, a, u0 = 0, v0 = null) {
    const vv = v0 === null ? origin[1] : v0;
    const p0 = origin;
    const p1 = [origin[0] + right[0] * w, origin[1], origin[2] + right[2] * w];
    const p2 = [p1[0], p1[1] + h, p1[2]];
    const p3 = [origin[0], origin[1] + h, origin[2]];
    this.quad(p0, p1, p2, p3, [u0, vv], [u0 + w, vv], [u0 + w, vv + h], [u0, vv + h], a);
  }

  // Axis-aligned box (optionally rotated around Y by rotY about its center). UVs in meters per face.
  // skip: set of face names to skip: 'px','nx','py','ny','pz','nz'
  box(cx, cy, cz, sx, sy, sz, a, rotY = 0, skip = null, uvScale = 1) {
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const c = Math.cos(rotY), s = Math.sin(rotY);
    const tr = (x, y, z) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
    const rd = (x, y, z) => [x * c + z * s, y, -x * s + z * c];
    const k = uvScale;
    const F = (name, pts, n, t, uvs) => {
      if (skip && skip.has(name)) return;
      this.quad(tr(...pts[0]), tr(...pts[1]), tr(...pts[2]), tr(...pts[3]), uvs[0], uvs[1], uvs[2], uvs[3], a, rd(...n), rd(...t));
    };
    // world-ish uvs (meters): use local coords offset by center to decorrelate
    const ox = cx + cz * 0.37, oy = cy, oz = cz + cx * 0.21;
    F('pz', [[-hx, -hy, hz], [hx, -hy, hz], [hx, hy, hz], [-hx, hy, hz]], [0, 0, 1], [1, 0, 0],
      [[(ox - hx) * k, (oy - hy) * k], [(ox + hx) * k, (oy - hy) * k], [(ox + hx) * k, (oy + hy) * k], [(ox - hx) * k, (oy + hy) * k]]);
    F('nz', [[hx, -hy, -hz], [-hx, -hy, -hz], [-hx, hy, -hz], [hx, hy, -hz]], [0, 0, -1], [-1, 0, 0],
      [[(ox - hx) * k, (oy - hy) * k], [(ox + hx) * k, (oy - hy) * k], [(ox + hx) * k, (oy + hy) * k], [(ox - hx) * k, (oy + hy) * k]]);
    F('px', [[hx, -hy, hz], [hx, -hy, -hz], [hx, hy, -hz], [hx, hy, hz]], [1, 0, 0], [0, 0, -1],
      [[(oz - hz) * k, (oy - hy) * k], [(oz + hz) * k, (oy - hy) * k], [(oz + hz) * k, (oy + hy) * k], [(oz - hz) * k, (oy + hy) * k]]);
    F('nx', [[-hx, -hy, -hz], [-hx, -hy, hz], [-hx, hy, hz], [-hx, hy, -hz]], [-1, 0, 0], [0, 0, 1],
      [[(oz - hz) * k, (oy - hy) * k], [(oz + hz) * k, (oy - hy) * k], [(oz + hz) * k, (oy + hy) * k], [(oz - hz) * k, (oy + hy) * k]]);
    F('py', [[-hx, hy, hz], [hx, hy, hz], [hx, hy, -hz], [-hx, hy, -hz]], [0, 1, 0], [1, 0, 0],
      [[(ox - hx) * k, (oz + hz) * k], [(ox + hx) * k, (oz + hz) * k], [(ox + hx) * k, (oz - hz) * k], [(ox - hx) * k, (oz - hz) * k]]);
    F('ny', [[-hx, -hy, -hz], [hx, -hy, -hz], [hx, -hy, hz], [-hx, -hy, hz]], [0, -1, 0], [1, 0, 0],
      [[(ox - hx) * k, (oz - hz) * k], [(ox + hx) * k, (oz - hz) * k], [(ox + hx) * k, (oz + hz) * k], [(ox - hx) * k, (oz + hz) * k]]);
  }

  // Box spanning two points (a beam/rod) with square cross-section of size th.
  beam(p0, p1, th, a, th2 = null) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const m = new THREE.Matrix4();
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.compose(new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    this.geometry(unitBox(), m, a, [th, len, th2 ?? th]);
  }

  // Cylinder between two points (pipes, poles)
  cyl(p0, p1, r, a, seg = 6, r1 = null) {
    const dx = p1[0] - p0[0], dy = p1[1] - p0[1], dz = p1[2] - p0[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-4) return;
    const m = new THREE.Matrix4();
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    m.compose(new THREE.Vector3((p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2), q, new THREE.Vector3(1, 1, 1));
    this.geometry(unitCyl(seg), m, a, [r, len, r]);
  }

  // Append an arbitrary BufferGeometry (non-indexed or indexed) with a transform and optional pre-scale.
  geometry(geo, matrix, a, scale = null) {
    const pos = geo.attributes.position, nrm = geo.attributes.normal, uv = geo.attributes.uv;
    const nm = new THREE.Matrix3().getNormalMatrix(matrix);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const base = this.count;
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i));
      if (scale) v.set(v.x * scale[0], v.y * scale[1], v.z * scale[2]);
      v.applyMatrix4(matrix);
      n.set(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      if (scale) n.set(n.x / scale[0], n.y / scale[1], n.z / scale[2]);
      n.applyMatrix3(nm).normalize();
      // tangent: any perpendicular
      const t = Math.abs(n.y) < 0.9 ? norm(cross([0, 1, 0], [n.x, n.y, n.z])) : [1, 0, 0];
      this._pushVert([v.x, v.y, v.z], [n.x, n.y, n.z], t, uv ? [uv.getX(i), uv.getY(i)] : [0, 0], a);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) this.idx.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) this.idx.push(base + i);
    }
  }

  build() {
    if (!this.count) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('tangent', new THREE.Float32BufferAttribute(this.tan, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const k in this.attrDefs) g.setAttribute(k, new THREE.Float32BufferAttribute(this.attrs[k], 4));
    const IndexArr = this.count > 65535 ? Uint32Array : Uint16Array;
    g.setIndex(new THREE.BufferAttribute(new IndexArr(this.idx), 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}

const _cyls = {};
function unitCyl(seg) {
  if (!_cyls[seg]) _cyls[seg] = new THREE.CylinderGeometry(1, 1, 1, seg, 1, false);
  return _cyls[seg];
}
let _unitBox = null;
function unitBox() {
  if (!_unitBox) _unitBox = new THREE.BoxGeometry(1, 1, 1);
  return _unitBox;
}

export function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
export function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }

// Chunked bucket registry: key = chunkId + material key
export class ChunkedBuckets {
  constructor(chunkSize = 96) {
    this.size = chunkSize;
    this.map = new Map();
  }
  get(x, z, matKey, attrDefs) {
    const cx = Math.floor(x / this.size), cz = Math.floor(z / this.size);
    const key = `${cx},${cz}|${matKey}`;
    let b = this.map.get(key);
    if (!b) { b = new Bucket(attrDefs); b.matKey = matKey; b.chunk = [cx, cz]; this.map.set(key, b); }
    return b;
  }
}
