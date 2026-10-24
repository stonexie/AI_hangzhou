// Backstreet alley (ref panel 4): paving, stone stairs rising per LAYOUT.alley.stairs, upper level, handrails, clutter.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './rng.js';
const LEAF = new THREE.IcosahedronGeometry(0.3, 1);
import { FACADE_ATTRS, DETAIL_ATTRS, trimAttr } from './architecture.js';

export function buildAlley(ctx, lots, B, out) {
  const L = ctx.layout;
  const A = L.alley;
  const S = A.stairs;
  const rng = mulberry32(0xA11E);
  const zN = A.z - A.width / 2, zS = A.z + A.width / 2, zc = A.z, w = A.width;
  const fac = (x) => B.get(x, zc, 'facade', FACADE_ATTRS);
  const det = (x) => B.get(x, zc, 'detail', DETAIL_ATTRS);
  const pave = (x0, x1, y) => {
    const a = { aWin: [0.3, 3, 3, 9999], aWin2: [0.5, 0.5, 0, 4], aWin3: [9999, 1, 2.2, 0.4] };
    fac((x0 + x1) / 2).quad([x0, y, zS], [x1, y, zS], [x1, y, zN], [x0, y, zN], [x0, -zS], [x1, -zS], [x1, -zN], [x0, -zN], a, [0, 1, 0], [1, 0, 0]);
  };
  const xEndWall = A.xEnd; // closing building facade plane
  // lower paving (slightly above ground to avoid z-fight)
  pave(S.xStart, A.xStart, 0.025);
  // stairs: two flights with a landing
  const stone = trimAttr(1, 1.6, 0.35, 0.77);
  const flights = [];
  const midX0 = S.xStart + (S.xEnd - S.xStart) * 0.45, midX1 = S.xStart + (S.xEnd - S.xStart) * 0.55;
  flights.push({ xa: S.xStart, xb: midX0, ya: 0, yb: S.rise / 2 });
  flights.push({ xa: midX1, xb: S.xEnd, ya: S.rise / 2, yb: S.rise });
  for (const f of flights) {
    const run = Math.abs(f.xb - f.xa), rise = f.yb - f.ya;
    const n = Math.round(rise / 0.165);
    const tread = run / n, riser = rise / n;
    for (let i = 0; i < n; i++) {
      const x0 = f.xa - i * tread, x1 = x0 - tread;
      const yTop = f.ya + (i + 1) * riser;
      fac(x0).box((x0 + x1) / 2 - 0.02, yTop / 2, zc, tread + 0.04, yTop, w, trimAttr(1, 1.6, 0.3 + rng() * 0.15, 0.77 + rng() * 0.2));
      // worn nosing strip (darker metal edge)
      det(x0).box(x0 - 0.03, yTop - 0.01, zc, 0.05, 0.025, w - 0.1, { aCol: [0.12, 0.12, 0.11, 0], aPbr: [0.3, 0.8, 0, 0.6] });
    }
    // ramp collider along the flight
    const len = Math.hypot(run, rise), ang = Math.atan2(rise, run);
    const cx = (f.xa + f.xb) / 2, cy = (f.ya + f.yb) / 2 - 0.15;
    // rotate around z so the ramp rises toward -x
    out.colliders.push({ x: cx, y: cy, z: zc, hx: len / 2, hy: 0.15, hz: w / 2, rot: { x: 0, y: 0, z: Math.sin(-ang / 2), w: Math.cos(-ang / 2) } });
  }
  // landing
  fac(midX0).box((midX0 + midX1) / 2, S.rise / 4, zc, midX0 - midX1, S.rise / 2, w, stone);
  out.colliders.push({ x: (midX0 + midX1) / 2, y: S.rise / 4, z: zc, hx: (midX0 - midX1) / 2, hy: S.rise / 4, hz: w / 2 });
  // upper level platform
  const ux0 = xEndWall, ux1 = S.xEnd;
  fac(ux0).box((ux0 + ux1) / 2, S.rise / 2 - 0.01, zc, ux1 - ux0, S.rise - 0.02, w, stone, 0, new Set(['py']));
  pave(ux0, ux1, S.rise);
  out.colliders.push({ x: (ux0 + ux1) / 2, y: S.rise / 2, z: zc, hx: (ux1 - ux0) / 2, hy: S.rise / 2, hz: w / 2 });

  // handrails along both walls + central rail on the stairs
  const metal = { aCol: [0.07, 0.07, 0.07, 0], aPbr: [0.3, 0.85, 0, 0.5] };
  const yAt = (x) => {
    if (x > S.xStart) return 0;
    if (x > midX0) return (S.xStart - x) / (S.xStart - midX0) * S.rise / 2;
    if (x > midX1) return S.rise / 2;
    if (x > S.xEnd) return S.rise / 2 + (midX1 - x) / (midX1 - S.xEnd) * S.rise / 2;
    return S.rise;
  };
  for (const z of [zN + 0.18, zS - 0.18, zc]) {
    const pts = [];
    for (let x = S.xStart + 0.5; x >= S.xEnd - 0.5; x -= 0.5) pts.push([x, yAt(x) + 0.9, z]);
    for (let i = 0; i < pts.length - 1; i++) det(pts[i][0]).beam(pts[i], pts[i + 1], 0.045, metal);
    for (let i = 0; i < pts.length; i += 3) {
      const p = pts[i];
      det(p[0]).beam([p[0], yAt(p[0]), z], p, 0.04, metal);
    }
    if (z === zc) continue;
    // lower rail
    for (let i = 0; i < pts.length - 1; i++) det(pts[i][0]).beam([pts[i][0], pts[i][1] - 0.45, z], [pts[i + 1][0], pts[i + 1][1] - 0.45, z], 0.025, metal);
  }

  // potted plants on the stairs by the walls (classic Tokyo backstreet)
  for (let x = S.xStart - 1.2; x > S.xEnd + 0.5; x -= rng.range(1.0, 2.6)) {
    if (!rng.chance(0.6)) continue;
    const z = rng.chance(0.5) ? zN + 0.42 : zS - 0.42;
    const y = yAt(x + 0.25);
    const pot = { aCol: rng.pick([[0.45, 0.25, 0.15], [0.2, 0.2, 0.22], [0.6, 0.6, 0.58]]), aPbr: [0.6, 0, 0, 0.6] };
    pot.aCol = [...pot.aCol, 0];
    det(x).cyl([x, y, z], [x, y + 0.35, z], 0.16, pot, 8);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x + rng.range(-0.12, 0.12), y + 0.55 + k * 0.12, z + rng.range(-0.1, 0.1)), new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * 3, rng() * 3, 0)), new THREE.Vector3(rng.range(0.6, 1.0), rng.range(0.6, 1.1), rng.range(0.6, 1.0)));
      det(x).geometry(LEAF, m, { aCol: [0.05, 0.11 + rng() * 0.07, 0.035, 0], aPbr: [0.45, 0, 0, 0.3] });
    }
  }
  // lit doors at the landing (both sides)
  for (const z of [zN + 0.02, zS - 0.02]) {
    const x = (midX0 + midX1) / 2;
    const n = z < zc ? 1 : -1;
    det(x).box(x, S.rise / 2 + 1.05, z + n * 0.01, 0.9, 2.1, 0.04, { aCol: [0.35, 0.25, 0.15, 0], aPbr: [0.5, 0, 0, 0.6] });
    det(x).box(x, S.rise / 2 + 2.3, z + n * 0.1, 0.22, 0.12, 0.18, { aCol: [1, 0.8, 0.5, 4], aPbr: [0.5, 0, 0, 0] });
  }
  out.lights.push({ pos: [(midX0 + midX1) / 2, S.rise / 2 + 2.6, zc], color: [1, 0.75, 0.45], intensity: 4, distance: 8 });

  // clutter: beer crates, bins, buckets, bikes, pipes along walls
  const crate = (x, y, z, col) => {
    const r = rng.range(-0.3, 0.3);
    const a = { aCol: [...col, 0.02], aPbr: [0.35, 0, 0, 0.5] };
    // frame posts + rails (open plastic beer crate) with bottles inside
    for (const [dx, dz] of [[-0.21, -0.16], [0.21, -0.16], [-0.21, 0.16], [0.21, 0.16]]) det(x).box(x + dx, y + 0.15, z + dz, 0.03, 0.3, 0.03, a, r);
    for (const yy of [0.02, 0.15, 0.28]) { det(x).box(x, y + yy, z - 0.16, 0.45, 0.04, 0.03, a, r); det(x).box(x, y + yy, z + 0.16, 0.45, 0.04, 0.03, a, r); }
    det(x).box(x, y + 0.02, z, 0.45, 0.04, 0.35, a, r);
    det(x).box(x, y + 0.14, z, 0.4, 0.24, 0.3, { aCol: [0.12, 0.06, 0.02, 0], aPbr: [0.15, 0, 0, 0.1] }, r);
  };
  for (let x = A.xStart - 2; x > A.xEnd + 1; x -= rng.range(1.2, 3.5)) {
    if (x < S.xStart + 0.5 && x > S.xEnd - 0.5) continue;
    const y = yAt(x);
    const z = rng.chance(0.5) ? zN + 0.35 : zS - 0.35;
    const r = rng();
    if (r < 0.4) {
      const col = rng.pick([[0.7, 0.1, 0.08], [0.1, 0.35, 0.15], [0.75, 0.6, 0.1], [0.15, 0.2, 0.5]]);
      const n = rng.int(1, 4);
      for (let k = 0; k < n; k++) crate(x, y + k * 0.3, z, col);
    } else if (r < 0.6) {
      // wheeled refuse bin with lid, handle and wheels
      const bc = rng.pick([[0.12, 0.22, 0.14], [0.15, 0.2, 0.35], [0.3, 0.3, 0.3]]);
      det(x).box(x, y + 0.5, z, 0.58, 0.8, 0.62, { aCol: [...bc, 0], aPbr: [0.35, 0.1, 0, 0.8] });
      det(x).box(x, y + 0.93, z + 0.02, 0.64, 0.06, 0.7, { aCol: [bc[0] * 0.8, bc[1] * 0.8, bc[2] * 0.8, 0], aPbr: [0.3, 0.1, 0, 0.6] });
      det(x).box(x, y + 0.85, z - 0.35, 0.5, 0.04, 0.04, { aCol: [0.05, 0.05, 0.05, 0], aPbr: [0.4, 0, 0, 0.3] });
      for (const dx of [-0.22, 0.22]) det(x).cyl([x + dx, y + 0.08, z - 0.25], [x + dx, y + 0.08, z - 0.33], 0.08, { aCol: [0.03, 0.03, 0.03, 0], aPbr: [0.6, 0, 0, 0.2] }, 8);
      det(x).box(x, y + 0.55, z + (z < zc ? 0.315 : -0.315), 0.3, 0.2, 0.01, { aCol: [0.9, 0.85, 0.2, 0.05], aPbr: [0.4, 0, 0, 0.5] });
    } else if (r < 0.75) {
      // bucket + stacked boxes
      det(x).box(x, y + 0.2, z, 0.6, 0.4, 0.4, { aCol: [0.33, 0.24, 0.15, 0], aPbr: [0.85, 0, 0, 0.7] });
      det(x).box(x + 0.1, y + 0.55, z, 0.5, 0.3, 0.35, { aCol: [0.36, 0.27, 0.17, 0], aPbr: [0.85, 0, 0, 0.7] });
    } else if (r < 0.88) {
      // bicycle (very simplified: wheels as thin boxes + frame beams)
      const m2 = { aCol: [0.05, 0.05, 0.05, 0], aPbr: [0.4, 0.6, 0, 0.3] };
      for (const dx of [-0.5, 0.5]) det(x).box(x + dx, y + 0.33, z, 0.66, 0.66, 0.04, m2);
      det(x).beam([x - 0.5, y + 0.33, z], [x + 0.1, y + 0.8, z], 0.035, { aCol: [0.5, 0.05, 0.05, 0], aPbr: [0.3, 0.5, 0, 0.3] });
      det(x).beam([x + 0.1, y + 0.8, z], [x + 0.5, y + 0.33, z], 0.035, { aCol: [0.5, 0.05, 0.05, 0], aPbr: [0.3, 0.5, 0, 0.3] });
    } else {
      // gas cylinders
      for (let k = 0; k < 2; k++) det(x).box(x + k * 0.35, y + 0.6, z, 0.3, 1.2, 0.3, { aCol: [0.6, 0.6, 0.58, 0], aPbr: [0.4, 0.5, 0, 0.6] });
    }
  }
}
