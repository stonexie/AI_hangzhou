// Geometry batcher: accumulates quads/boxes/arbitrary geometries with per-vertex custom attributes
// into ONE BufferGeometry (one draw call per material).
import * as THREE from 'three/webgpu';

const _v = new THREE.Vector3(), _n = new THREE.Vector3(), _m3 = new THREE.Matrix3();

export class Batch {
  // schema: { name: itemSize } for custom attributes (position/normal/uv are implicit)
  constructor(schema = {}) {
    this.schema = schema;
    this.pos = []; this.nor = []; this.uv = []; this.idx = [];
    this.attrs = {};
    for (const k in schema) this.attrs[k] = [];
    this.count = 0;
  }

  _push(p, n, uv, a) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(uv[0], uv[1]);
    for (const k in this.schema) {
      const s = this.schema[k], v = a[k];
      if (v === undefined) for (let i = 0; i < s; i++) this.attrs[k].push(0);
      else if (typeof v === 'number') this.attrs[k].push(v);
      else for (let i = 0; i < s; i++) this.attrs[k].push(v[i] ?? 0);
    }
    return this.count++;
  }

  // Rectangle centered at c, spanning +-hu along u and +-hv along v, facing n. uvr = [u0,v0,u1,v1].
  quad(c, u, v, hu, hv, n, uvr = [0, 0, 1, 1], a = {}) {
    const p = (su, sv) => new THREE.Vector3().copy(c).addScaledVector(u, su * hu).addScaledVector(v, sv * hv);
    // optional 'luv' attribute: local metres (x, y, width, height) for per-face effects
    const L = this.schema.luv ? (su, sv) => ({ ...a, luv: [(su + 1) * hu, (sv + 1) * hv, 2 * hu, 2 * hv] }) : () => a;
    const i0 = this._push(p(-1, -1), n, [uvr[0], uvr[1]], L(-1, -1));
    const i1 = this._push(p(1, -1), n, [uvr[2], uvr[1]], L(1, -1));
    const i2 = this._push(p(1, 1), n, [uvr[2], uvr[3]], L(1, 1));
    const i3 = this._push(p(-1, 1), n, [uvr[0], uvr[3]], L(-1, 1));
    // ensure CCW wrt n
    const cr = new THREE.Vector3().crossVectors(u, v);
    if (cr.dot(n) >= 0) this.idx.push(i0, i1, i2, i0, i2, i3);
    else this.idx.push(i0, i2, i1, i0, i3, i2);
  }

  // Oriented box: center c, unit axes ax (x,y,z), half sizes h=[hx,hy,hz]. faceAttrs(faceName)->attrs optional.
  // skip: set of face names to omit ('+x','-x','+y','-y','+z','-z'). uvScale: world meters per uv unit.
  box(c, ax, h, a = {}, skip = null, faceAttrs = null) {
    const [X, Y, Z] = ax;
    const faces = [
      ['+x', X, Z, Y, h[0], h[2], h[1]], ['-x', X.clone().negate(), Z, Y, h[0], h[2], h[1]],
      ['+y', Y, X, Z, h[1], h[0], h[2]], ['-y', Y.clone().negate(), X, Z, h[1], h[0], h[2]],
      ['+z', Z, X, Y, h[2], h[0], h[1]], ['-z', Z.clone().negate(), X, Y, h[2], h[0], h[1]],
    ];
    for (const [name, n, u, v, d, hu, hv] of faces) {
      if (skip && skip.has(name)) continue;
      const cc = c.clone().addScaledVector(n, d);
      const fa = faceAttrs ? { ...a, ...faceAttrs(name) } : a;
      this.quad(cc, u, v, hu, hv, n, [0, 0, hu * 2, hv * 2], fa);
    }
  }

  // Add an existing (indexed or not) BufferGeometry transformed by matrix.
  geometry(geom, matrix, a = {}) {
    const P = geom.attributes.position, N = geom.attributes.normal, U = geom.attributes.uv;
    _m3.getNormalMatrix(matrix);
    const base = this.count;
    for (let i = 0; i < P.count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(matrix);
      if (N) _n.fromBufferAttribute(N, i).applyMatrix3(_m3).normalize(); else _n.set(0, 1, 0);
      const va = typeof a === 'function' ? a(i) : a;
      this._push(_v, _n, U ? [U.getX(i), U.getY(i)] : [0, 0], va);
    }
    if (geom.index) for (let i = 0; i < geom.index.count; i++) this.idx.push(base + geom.index.getX(i));
    else for (let i = 0; i < P.count; i++) this.idx.push(base + i);
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    for (const k in this.schema) g.setAttribute(k, new THREE.Float32BufferAttribute(this.attrs[k], this.schema[k]));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }
}
