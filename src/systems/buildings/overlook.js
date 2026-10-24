// Overlook (ref panel 2): cantilevered rooftop deck with a dark metal railing in the foreground, clear view NE.
import { FACADE_ATTRS, DETAIL_ATTRS, trimAttr } from './architecture.js';

export function buildOverlook(ctx, lots, B, out) {
  const L = ctx.layout;
  const ov = L.overlook.position;
  const lot = lots.find((l) => l.overlook);
  if (!lot) return;
  const y = lot.overlook.deckY;
  const x0 = lot.x0 + 0.5, x1 = lot.x1 - 0.5;
  const zFront = lot.z0;            // building north face
  const zEdge = ov[2] - 1.35;        // deck edge (railing) in front of the camera
  const fac = B.get(ov[0], ov[2], 'facade', FACADE_ATTRS);
  const det = B.get(ov[0], ov[2], 'detail', DETAIL_ATTRS);
  const slab = trimAttr(1, 3, 0.45, 0.31);
  // deck slab (cantilever)
  fac.box((x0 + x1) / 2, y - 0.2, (zFront + zEdge) / 2, x1 - x0, 0.4, zFront - zEdge, slab);
  // deck surface: wet, puddled roof material
  const ra = { aWin: [0.2, 3, 3, 9999], aWin2: [0.5, 0.5, 0, 4], aWin3: [9999, 7, 3.0, 0.4] };
  fac.quad([x0, y + 0.005, zFront], [x1, y + 0.005, zFront], [x1, y + 0.005, zEdge], [x0, y + 0.005, zEdge],
    [x0, -zFront], [x1, -zFront], [x1, -zEdge], [x0, -zEdge], ra, [0, 1, 0], [1, 0, 0]);
  // steel brackets under the cantilever
  const steel = { aCol: [0.06, 0.06, 0.065, 0], aPbr: [0.4, 0.8, 0, 0.5] };
  for (let x = x0 + 0.3; x <= x1; x += (x1 - x0 - 0.6) / 3) {
    det.beam([x, y - 0.4, zEdge + 0.3], [x, y - 3.8, zFront], 0.18, steel);
    det.beam([x, y - 0.45, zEdge + 0.1], [x, y - 0.45, zFront], 0.25, steel);
  }
  out.colliders.push({ x: (x0 + x1) / 2, y: y - 0.2, z: (zFront + zEdge) / 2, hx: (x1 - x0) / 2, hy: 0.2, hz: (zFront - zEdge) / 2 });

  // railing (dark metal, chunky like the reference)
  const rail = { aCol: [0.035, 0.035, 0.04, 0], aPbr: [0.28, 0.85, 0, 0.35] };
  const H = 1.12;
  const edge = [[x0 + 0.05, zFront - 0.05], [x0 + 0.05, zEdge + 0.05], [x1 - 0.05, zEdge + 0.05], [x1 - 0.05, zFront - 0.05]];
  for (let i = 0; i < 3; i++) {
    const [ax, az] = edge[i], [bx, bz] = edge[i + 1];
    det.beam([ax, y + H, az], [bx, y + H, bz], 0.075, rail, 0.06);
    det.beam([ax, y + H - 0.07, az], [bx, y + H - 0.07, bz], 0.03, rail);
    for (const hh of [0.35, 0.65]) det.beam([ax, y + hh, az], [bx, y + hh, bz], 0.028, rail);
    det.beam([ax, y + 0.08, az], [bx, y + 0.08, bz], 0.06, rail, 0.12);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.ceil(len / 1.4);
    for (let k = 0; k <= n; k++) {
      const t = k / n, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      det.beam([px, y, pz], [px, y + H, pz], 0.055, rail);
    }
    // thin vertical balusters
    const nb = Math.ceil(len / 0.14);
    for (let k = 0; k < nb; k++) {
      const t = (k + 0.5) / nb, px = ax + (bx - ax) * t, pz = az + (bz - az) * t;
      det.beam([px, y + 0.08, pz], [px, y + H - 0.07, pz], 0.014, rail);
    }
    const cx = (ax + bx) / 2, cz = (az + bz) / 2;
    out.colliders.push({ x: cx, y: y + H / 2, z: cz, hx: Math.max(Math.abs(bx - ax) / 2, 0.05), hy: H / 2, hz: Math.max(Math.abs(bz - az) / 2, 0.05) });
  }
  // deck clutter: planters, a bench, a lamp
  const planter = { aCol: [0.25, 0.25, 0.24, 0], aPbr: [0.7, 0, 0, 0.8] };
  const leaf = { aCol: [0.08, 0.16, 0.06, 0], aPbr: [0.6, 0, 0, 0.3] };
  for (const px of [x0 + 0.6, x1 - 0.6]) {
    det.box(px, y + 0.3, zEdge + 0.6, 0.7, 0.6, 0.7, planter);
    det.box(px, y + 0.8, zEdge + 0.6, 0.6, 0.5, 0.6, leaf);
  }
  det.box(x1 - 0.5, y + 0.22, (zFront + zEdge) / 2, 0.5, 0.44, 1.8, { aCol: [0.3, 0.2, 0.12, 0], aPbr: [0.5, 0, 0, 0.5] });
  // door housing on the roof with a lit door
  const hx = x0 + 2.2, hz = zFront + 3;
  fac.box(hx, y + 1.4, hz, 3.2, 2.8, 3.0, trimAttr(lot.wallLayer ?? 1, 3, 0.5, 0.6));
  det.box(hx, y + 1.05, hz - 1.51, 0.95, 2.1, 0.04, { aCol: [0.3, 0.3, 0.32, 0], aPbr: [0.4, 0.7, 0, 0.4] });
  det.box(hx, y + 2.3, hz - 1.6, 0.3, 0.12, 0.15, { aCol: [1, 0.85, 0.6, 3], aPbr: [0.5, 0, 0, 0] });
  out.colliders.push({ x: hx, y: y + 1.4, z: hz, hx: 1.6, hy: 1.4, hz: 1.5 });
  out.lights.push({ pos: [hx, y + 2.1, hz - 2.0], color: [1, 0.8, 0.55], intensity: 3, distance: 7 });
}
