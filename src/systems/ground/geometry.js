// Ground geometry builders: base ground rects, sidewalk slabs (rounded corners), granite curb ribbons,
// alley floors, promenade, embankment walls. Everything merged per material (few draw calls).
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { G, sidewalkPolys } from './plan.js';

// ---- polygon helpers (2D points [x, z]) -------------------------------------------------------------------
function signedArea(pts) { // in (x, -z) "shape space" => CCW when > 0
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, z1] = pts[i], [x2, z2] = pts[(i + 1) % pts.length];
    a += x1 * -z2 - x2 * -z1;
  }
  return a / 2;
}

export function roundPoly(pts, roundIdx, r, seg = 14) {
  const out = [];
  const set = new Set(roundIdx);
  for (let i = 0; i < pts.length; i++) {
    const V = pts[i];
    if (!set.has(i)) { out.push(V); continue; }
    const Pp = pts[(i - 1 + pts.length) % pts.length], N = pts[(i + 1) % pts.length];
    const dp = norm([Pp[0] - V[0], Pp[1] - V[1]]), dn = norm([N[0] - V[0], N[1] - V[1]]);
    const c = [V[0] + (dp[0] + dn[0]) * r, V[1] + (dp[1] + dn[1]) * r];
    const t1 = [V[0] + dp[0] * r, V[1] + dp[1] * r], t2 = [V[0] + dn[0] * r, V[1] + dn[1] * r];
    let a1 = Math.atan2(t1[1] - c[1], t1[0] - c[0]), a2 = Math.atan2(t2[1] - c[1], t2[0] - c[0]);
    let d = a2 - a1;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    for (let k = 0; k <= seg; k++) {
      const a = a1 + (d * k) / seg;
      out.push([c[0] + Math.cos(a) * r, c[1] + Math.sin(a) * r]);
    }
  }
  return out;
}
const norm = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// inward normals for a CCW (shape-space) polygon given in [x,z]
function edgeInward(pts) {
  // shape space s = (x, -z). CCW => inward is left of edge: (-dy, dx) in shape space.
  return pts.map((p, i) => {
    const q = pts[(i + 1) % pts.length];
    const sx = q[0] - p[0], sy = -(q[1] - p[1]);
    const n = norm([-sy, sx]);       // shape space
    return [n[0], -n[1]];            // back to [x, z]
  });
}

function insetPoly(pts, d) {
  const en = edgeInward(pts);
  return pts.map((p, i) => {
    const n1 = en[(i - 1 + pts.length) % pts.length], n2 = en[i];
    const s = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    const m = [(n1[0] + n2[0]) / Math.max(s, 0.2), (n1[1] + n2[1]) / Math.max(s, 0.2)];
    return [p[0] + m[0] * d, p[1] + m[1] * d];
  });
}

function shapeGeometry(pts, y, holes = []) {
  const shape = new THREE.Shape(pts.map(([x, z]) => new THREE.Vector2(x, -z)));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([x, z]) => new THREE.Vector2(x, -z))));
  const g = new THREE.ShapeGeometry(shape, 1);
  g.rotateX(-Math.PI / 2);
  g.translate(0, y, 0);
  return g;
}

// Curb ribbon along a closed polygon. Profile (inward offset, y): road bottom -> face -> chamfer -> top strip.
function curbRibbon(pts, curbW, curbH) {
  const n = pts.length;
  const en = edgeInward(pts);
  const vIn = pts.map((p, i) => { // miter inward vector
    const n1 = en[(i - 1 + n) % n], n2 = en[i];
    const s = 1 + n1[0] * n2[0] + n1[1] * n2[1];
    return [(n1[0] + n2[0]) / Math.max(s, 0.2), (n1[1] + n2[1]) / Math.max(s, 0.2)];
  });
  const smooth = pts.map((p, i) => {
    const n1 = en[(i - 1 + n) % n], n2 = en[i];
    return n1[0] * n2[0] + n1[1] * n2[1] > 0.85;
  });
  const prof = [[0, -0.06], [0, curbH - 0.022], [0.028, curbH], [curbW, curbH]];
  const profV = [0]; for (let k = 1; k < prof.length; k++) profV.push(profV[k - 1] + Math.hypot(prof[k][0] - prof[k - 1][0], prof[k][1] - prof[k - 1][1]));
  const pos = [], nor = [], uvs = [];
  let u = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const A = pts[i], Bp = pts[j];
    const len = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    const nA = smooth[i] ? norm(vIn[i]) : en[i];
    const nB = smooth[j] ? norm(vIn[j]) : en[i];
    for (let k = 0; k < prof.length - 1; k++) {
      const p0 = prof[k], p1 = prof[k + 1];
      // face normal in profile space: outward (-inward) for vertical, blend for chamfer, up for top
      const dIn = p1[0] - p0[0], dY = p1[1] - p0[1];
      const pl = Math.hypot(dIn, dY);
      const nOut = dY / pl, nUp = dIn / pl; // perpendicular (rotated) components
      const mk = (P, vin, nrm, off, y, uu, vv) => {
        pos.push(P[0] + vin[0] * off, y, P[1] + vin[1] * off);
        const nx = -nrm[0] * nOut, nz = -nrm[1] * nOut, ny = nUp;
        const l = Math.hypot(nx, ny, nz);
        nor.push(nx / l, ny / l, nz / l);
        uvs.push(uu, vv);
      };
      const a0 = [A, vIn[i], nA, p0[0], p0[1], u, profV[k]];
      const a1 = [A, vIn[i], nA, p1[0], p1[1], u, profV[k + 1]];
      const b0 = [Bp, vIn[j], nB, p0[0], p0[1], u + len, profV[k]];
      const b1 = [Bp, vIn[j], nB, p1[0], p1[1], u + len, profV[k + 1]];
      // winding: front faces outward/up
      for (const v of [a0, b0, b1, a0, b1, a1]) mk(...v);
    }
    u += len;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  // fix winding if needed: test first triangle normal against stored normal
  const p = g.attributes.position.array, nn = g.attributes.normal.array;
  const e1 = new THREE.Vector3(p[3] - p[0], p[4] - p[1], p[5] - p[2]), e2 = new THREE.Vector3(p[6] - p[0], p[7] - p[1], p[8] - p[2]);
  const fn = e1.cross(e2);
  if (fn.x * nn[0] + fn.y * nn[1] + fn.z * nn[2] < 0) {
    const idx = g.attributes.position.count;
    const arrP = g.attributes.position.array, arrN = g.attributes.normal.array, arrU = g.attributes.uv.array;
    for (let t = 0; t < idx; t += 3) { // swap v1 <-> v2
      for (const [arr, s] of [[arrP, 3], [arrN, 3], [arrU, 2]]) {
        for (let c = 0; c < s; c++) { const a = arr[(t + 1) * s + c]; arr[(t + 1) * s + c] = arr[(t + 2) * s + c]; arr[(t + 2) * s + c] = a; }
      }
    }
  }
  return g;
}

function rectsMinus(world, excl) {
  const xs = [...new Set([world.x0, world.x1, ...excl.flatMap((r) => [r.x0, r.x1])])].filter((v) => v >= world.x0 && v <= world.x1).sort((a, b) => a - b);
  const zs = [...new Set([world.z0, world.z1, ...excl.flatMap((r) => [r.z0, r.z1])])].filter((v) => v >= world.z0 && v <= world.z1).sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < zs.length - 1; j++) {
      const cx = (xs[i] + xs[i + 1]) / 2, cz = (zs[j] + zs[j + 1]) / 2;
      if (excl.some((r) => cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1)) continue;
      out.push({ x0: xs[i], x1: xs[i + 1], z0: zs[j], z1: zs[j + 1] });
    }
  }
  // merge vertically adjacent cells with same x span
  out.sort((a, b) => a.x0 - b.x0 || a.z0 - b.z0);
  const merged = [];
  for (const r of out) {
    const last = merged[merged.length - 1];
    if (last && last.x0 === r.x0 && last.x1 === r.x1 && Math.abs(last.z1 - r.z0) < 1e-6) last.z1 = r.z1; else merged.push({ ...r });
  }
  return merged;
}

function quad(r, y) {
  const g = new THREE.PlaneGeometry(r.x1 - r.x0, r.z1 - r.z0);
  g.rotateX(-Math.PI / 2);
  g.translate((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2);
  return g;
}

export function buildGroundGeometry() {
  const al = G.alley;
  const alleyLower = { x0: al.stairs.xStart, x1: al.x1, z0: al.z - al.half, z1: al.z + al.half };
  const alleyUpper = { x0: al.x0, x1: al.stairs.xEnd, z0: al.z - al.half, z1: al.z + al.half };
  const prom = { x0: G.prom.x0, x1: G.prom.x1, z0: G.prom.z0, z1: G.prom.z1 };
  const river = { x0: G.river.x0, x1: G.river.x1, z0: G.world.z0 - 1, z1: G.world.z1 + 1 };
  const baseRects = rectsMinus(G.world, [alleyLower, prom, river]);
  const base = mergeGeometries(baseRects.map((r) => quad(r, 0)));

  const swGeoms = [], curbGeoms = [], swColliders = [];
  for (const poly of sidewalkPolys()) {
    let pts = roundPoly(poly.pts, poly.round, G.cornerR);
    if (signedArea(pts) < 0) pts = pts.reverse();
    curbGeoms.push(curbRibbon(pts, G.curbW, G.curbH));
    const inner = insetPoly(pts, G.curbW);
    swGeoms.push(shapeGeometry(inner, G.curbH));
    swColliders.push(poly.pts);
  }
  const sidewalk = mergeGeometries(swGeoms);
  const curb = mergeGeometries(curbGeoms);

  const alley = mergeGeometries([quad(alleyLower, 0), quad(alleyUpper, al.stairs.rise)]);
  const promenade = quad(prom, G.prom.y);

  // embankment walls (river faces), from promenade level down below the water
  const wallH = 5.0, zA = G.world.z0, zB = G.world.z1;
  const wW = new THREE.PlaneGeometry(zB - zA, wallH); // west bank, faces +x
  wW.rotateY(Math.PI / 2); wW.translate(G.river.x0, -wallH / 2, (zA + zB) / 2);
  const wE = new THREE.PlaneGeometry(zB - zA, wallH); // east bank, faces -x
  wE.rotateY(-Math.PI / 2); wE.translate(G.river.x1, -wallH / 2, (zA + zB) / 2);
  const wall = mergeGeometries([wW, wE]);

  return { base, sidewalk, curb, alley, promenade, wall, baseRects, alleyLower, alleyUpper, prom, swColliders };
}
