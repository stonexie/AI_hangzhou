// Utility poles + sagging power/telecom cables (ref panel 1 & 4): along the avenue, cross streets, the alley,
// service drops to facades, and building-to-building spans.
import { mulberry32 } from './rng.js';
import { DETAIL_ATTRS } from './architecture.js';

const WIRE = { aCol: [0.015, 0.015, 0.017, 0], aPbr: [0.35, 0.2, 0, 0] };
const POLE = { aCol: [0.42, 0.41, 0.39, 0], aPbr: [0.75, 0, 0, 0.9] };
const ARM = { aCol: [0.2, 0.2, 0.2, 0], aPbr: [0.45, 0.7, 0, 0.6] };
const INS = { aCol: [0.6, 0.62, 0.6, 0], aPbr: [0.3, 0, 0, 0.3] };

export function buildCables(ctx, lots, B, out) {
  const L = ctx.layout;
  const rng = mulberry32(0xCAB1E);
  const det = (x, z) => B.get(x, z, 'detail', DETAIL_ATTRS);

  function wire(a, b, sag, th = 0.022, segs = 10) {
    const len = Math.hypot(b[0] - a[0], b[2] - a[2]);
    const n = Math.max(3, Math.min(segs, Math.ceil(len / 2.5)));
    let prev = a;
    const bucket = det((a[0] + b[0]) / 2, (a[2] + b[2]) / 2);
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t - sag * 4 * t * (1 - t), a[2] + (b[2] - a[2]) * t];
      bucket.beam(prev, p, th, WIRE);
      prev = p;
    }
  }
  const sagFor = (len) => 0.12 + len * rng.range(0.025, 0.05);

  // ---------- pole lines ----------
  // dir: 'z' => line runs along z (crossarms along x); 'x' => runs along x
  function poleLine(fixed, from, to, dir, opts = {}) {
    const poles = [];
    const skip = opts.skip || (() => false);
    let t = from + rng.range(2, 8);
    const step = opts.step || 24;
    while ((from < to && t < to) || (from > to && t > to)) {
      if (!skip(t)) poles.push(dir === 'z' ? [fixed, t] : [t, fixed]);
      t += (from < to ? 1 : -1) * (step + rng.range(-4, 4));
    }
    const tops = [];
    for (const [x, z] of poles) {
      const H = rng.range(10.5, 12);
      const b = det(x, z);
      b.cyl([x, 0, z], [x, H, z], 0.17, POLE, 8);
      b.cyl([x, H, z], [x, H + 0.2, z], 0.12, POLE, 8);
      const arms = [];
      const armYs = [H - 0.4, H - 1.3, H - 2.3];
      for (const y of armYs) {
        const half = 0.95;
        const a0 = dir === 'z' ? [x - half, y, z] : [x, y, z - half], a1 = dir === 'z' ? [x + half, y, z] : [x, y, z + half];
        b.beam(a0, a1, 0.09, ARM);
        const pts = [];
        for (const f of [-0.85, 0, 0.85]) {
          const p = dir === 'z' ? [x + f, y + 0.12, z] : [x, y + 0.12, z + f];
          b.box(p[0], p[1], p[2], 0.07, 0.14, 0.07, INS);
          pts.push([p[0], p[1] + 0.08, p[2]]);
        }
        arms.push(pts);
        // diagonal brace
        b.beam([x, y - 0.5, z], dir === 'z' ? [x + 0.6, y, z] : [x, y, z + 0.6], 0.04, ARM);
      }
      // transformer + telecom box
      if (rng.chance(0.4)) {
        const ox = dir === 'z' ? 0 : 0.42, oz = dir === 'z' ? 0.42 : 0;
        b.cyl([x + ox, H - 4.2, z + oz], [x + ox, H - 3.1, z + oz], 0.3, { aCol: [0.5, 0.52, 0.5, 0], aPbr: [0.5, 0.3, 0, 0.7] }, 10);
        b.beam([x, H - 3.6, z], [x + ox, H - 3.6, z + oz], 0.05, ARM);
      }
      b.box(x + (dir === 'z' ? 0.25 : 0), 5.2, z + (dir === 'z' ? 0 : 0.25), 0.3, 0.45, 0.3, { aCol: [0.55, 0.55, 0.52, 0], aPbr: [0.5, 0.2, 0, 0.8] });
      // telecom cable clamp ring
      const tel = [x, 6.2, z], tel2 = [x, 5.8, z];
      // step bolts
      for (let y = 2.4; y < H - 2.5; y += 0.45) {
        const s = (Math.round(y / 0.45) % 2 ? 1 : -1) * 0.22;
        b.beam([x, y, z], dir === 'z' ? [x, y, z + s] : [x + s, y, z], 0.025, ARM);
      }
      // address plate
      b.box(x + (dir === 'z' ? -0.18 : 0), 2.2, z + (dir === 'z' ? 0 : -0.18), dir === 'z' ? 0.02 : 0.22, 0.55, dir === 'z' ? 0.22 : 0.02, { aCol: [0.6, 0.55, 0.15, 0], aPbr: [0.5, 0, 0, 0.7] });
      out.colliders.push({ x, y: H / 2, z, hx: 0.18, hy: H / 2, hz: 0.18 });
      tops.push({ x, z, arms, tel, tel2, H });
    }
    // wires between consecutive poles
    for (let i = 0; i < tops.length - 1; i++) {
      const A = tops[i], Bp = tops[i + 1];
      const len = Math.hypot(Bp.x - A.x, Bp.z - A.z);
      if (len > 45) continue;
      for (let k = 0; k < 3; k++) for (let j = 0; j < 3; j++) {
        if (k === 2 && j === 1) continue;
        wire(A.arms[k][j], Bp.arms[k][j], sagFor(len) * (k === 0 ? 0.8 : 1.0), 0.016);
      }
      wire(A.tel, Bp.tel, sagFor(len) * 1.3, 0.04);
      wire(A.tel2, Bp.tel2, sagFor(len) * 1.5, 0.03);
      if (rng.chance(0.5)) wire([A.x, 6.6, A.z], [Bp.x, 6.6, Bp.z], sagFor(len) * 1.2, 0.025);
    }
    return tops;
  }

  // ---------- service drops to facades ----------
  function drops(tops, facadeAt) {
    for (const p of tops) {
      const n = rng.int(2, 5);
      for (let k = 0; k < n; k++) {
        const tgt = facadeAt(p, rng.range(-9, 9), rng.range(4.5, 9.5));
        if (!tgt) continue;
        const src = rng.chance(0.5) ? p.tel : p.arms[2][rng.int(0, 2)];
        const len = Math.hypot(tgt[0] - src[0], tgt[2] - src[2]);
        wire(src, tgt, sagFor(len) * 0.7, rng.chance(0.5) ? 0.016 : 0.022, 6);
        // wall anchor
        det(tgt[0], tgt[2]).box(tgt[0], tgt[1], tgt[2], 0.1, 0.1, 0.1, ARM);
      }
    }
  }

  const av = L.avenue;
  const X = av.roadHalfWidth + 0.7;
  const cz = L.crossStreets.zs;
  const avSkip = (z) => cz.some((c) => Math.abs(z - c) < 10) || Math.abs(z - L.elevatedRail.z) < 8 || Math.abs(z - L.expressway.z) < 11 || Math.abs(z - L.alley.z) < 3.5;
  const front = L.blocks.frontageOffset;
  const east = poleLine(X, av.zStart - 4, av.zEnd + 4, 'z', { skip: avSkip, step: 22 });
  const west = poleLine(-X, av.zStart - 12, av.zEnd + 4, 'z', { skip: avSkip, step: 22 });
  drops(east, (p, dz, y) => [front - 0.02, y, p.z + dz]);
  drops(west, (p, dz, y) => [-front + 0.02, y, p.z + dz]);
  // spans across the avenue: pole to pole and facade to facade
  for (let i = 0; i < Math.min(east.length, west.length); i++) {
    const e = east[i];
    const w = west.reduce((best, q) => (Math.abs(q.z - e.z) < Math.abs(best.z - e.z) ? q : best), west[0]);
    if (Math.abs(w.z - e.z) > 14) continue;
    if (rng.chance(0.65)) wire(e.arms[1][0], w.arms[1][2], 0.9, 0.02);
    if (rng.chance(0.5)) wire(e.tel, w.tel, 1.2, 0.035);
  }
  for (let z = av.zStart - 6; z > av.zEnd; z -= rng.range(10, 22)) {
    if (avSkip(z)) continue;
    const y1 = rng.range(7, 13), y2 = y1 + rng.range(-2, 2);
    wire([front - 0.05, y1, z], [-front + 0.05, y2, z + rng.range(-6, 6)], rng.range(0.8, 1.8), 0.02, 12);
  }

  // ---------- cross streets (near the avenue) ----------
  const cs = L.crossStreets;
  for (const c of cz) {
    const zN = c - cs.roadHalfWidth - 0.6, zS = c + cs.roadHalfWidth + 0.6;
    for (const sgn of [1, -1]) {
      const xa = sgn * (front + 3), xb = sgn * 125;
      const t1 = poleLine(zN, xa, xb, 'x', { step: 26 });
      const t2 = poleLine(zS, xa, xb, 'x', { step: 26 });
      drops(t1, (p, dx, y) => [p.x + dx, y, c - cs.roadHalfWidth - cs.sidewalkWidth + 0.02]);
      drops(t2, (p, dx, y) => [p.x + dx, y, c + cs.roadHalfWidth + cs.sidewalkWidth - 0.02]);
      for (let i = 0; i < Math.min(t1.length, t2.length); i++) if (rng.chance(0.5)) wire(t1[i].tel, t2[i].tel, 0.9, 0.03);
    }
  }

  // ---------- the alley: dense criss-crossing wires ----------
  const A = L.alley, S = A.stairs;
  const zN = A.z - A.width / 2 + 0.02, zS = A.z + A.width / 2 - 0.02;
  const gY = (x) => (x > S.xStart ? 0 : x < S.xEnd ? S.rise : (S.xStart - x) / (S.xStart - S.xEnd) * S.rise);
  for (let x = A.xStart - 1; x > A.xEnd + 1; x -= rng.range(0.6, 1.8)) {
    const y = gY(x) + rng.range(3.4, 10);
    const x2 = x + rng.range(-3, 3);
    wire([x, y, zN], [x2, gY(x2) + rng.range(3.4, 10), zS], rng.range(0.15, 0.7), rng.chance(0.3) ? 0.03 : 0.016, 6);
    det(x, zN).box(x, y, zN + 0.04, 0.08, 0.08, 0.08, ARM);
  }
  // long runs along the alley walls & bundles
  for (let k = 0; k < 14; k++) {
    const z = rng.chance(0.5) ? zN + rng.range(0.05, 0.6) : zS - rng.range(0.05, 0.6);
    let x = A.xStart - rng.range(0, 6);
    while (x > A.xEnd + 3) {
      const x2 = Math.max(A.xEnd + 1, x - rng.range(4, 9));
      const y1 = gY(x) + 4 + k * 0.35, y2 = gY(x2) + 4 + k * 0.35;
      wire([x, y1, z], [x2, y2, z + rng.range(-0.3, 0.3)], rng.range(0.1, 0.5), 0.018, 5);
      x = x2;
    }
  }
}
