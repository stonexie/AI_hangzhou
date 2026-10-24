// Architecture: lot -> volumes -> facade quads (procedural windows in shader), roofs, parapets, trims.
import { STYLES } from './plan.js';
import { mulberry32 } from './rng.js';

export const FACADE_ATTRS = { aWin: [0, 3.2, 3, 4], aWin2: [0.5, 0.5, 0.3, 5], aWin3: [100, 1, 4, 0] };
export const DETAIL_ATTRS = { aCol: [1, 1, 1, 0], aPbr: [0.6, 0, 0, 0.5] };

// side helpers: returns { origin, right, normal, width }
export function sideFrame(v, side, y = 0) {
  switch (side) {
    case 'nx': return { origin: [v.x0, y, v.z0], right: [0, 0, 1], normal: [-1, 0, 0], width: v.z1 - v.z0 };
    case 'px': return { origin: [v.x1, y, v.z1], right: [0, 0, -1], normal: [1, 0, 0], width: v.z1 - v.z0 };
    case 'nz': return { origin: [v.x1, y, v.z0], right: [-1, 0, 0], normal: [0, 0, -1], width: v.x1 - v.x0 };
    default: return { origin: [v.x0, y, v.z1], right: [1, 0, 0], normal: [0, 0, 1], width: v.x1 - v.x0 };
  }
}
export const SIDES = ['nx', 'px', 'nz', 'pz'];

// Trim attribute (plain wall, given layer)
export function trimAttr(layer, texScale = 3, tint = 0.5, seed = 0.5) {
  return { aWin: [seed, 3, 3, 9999], aWin2: [0.5, 0.5, 0, 5], aWin3: [9999, layer, texScale, tint] };
}

export function buildLotArchitecture(lot, B, out) {
  const st = STYLES[lot.style];
  const rng = mulberry32((lot.id * 7919 + 13) >>> 0);
  const tint = rng();
  const litP = lot.detail === 'hi' ? rng.range(0.2, 0.4) : rng.range(0.28, 0.5);
  const bayT = rng.range(st.bay[0], st.bay[1]);
  const wwF = rng.range(st.ww[0], st.ww[1]);
  const whF = rng.range(st.wh[0], st.wh[1]);
  const kindFront = st.kind;
  const seed = lot.seed;
  const layer = (st.layer === 0 && rng.chance(0.3)) ? 6 : st.layer;
  const trimLayer = rng.chance(0.6) ? 1 : layer;
  lot.wallLayer = layer;
  const roofLayer = rng.weighted([[7, 5], [1, 3], [lot.style === 'corrugated' ? 2 : 3, 1]]);
  const roofTint = rng();

  // volumes
  const vols = [];
  const base = { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z1, y0: 0, y1: lot.h };
  if (lot.setback) {
    const yS = lot.groundH + (lot.setback.atFloor - 1) * lot.floorH;
    base.y1 = yS;
    vols.push(base);
    const ins = lot.setback.inset;
    const frontSides = new Set(lot.fronts.map((f) => f.side));
    const up = { x0: lot.x0, x1: lot.x1, z0: lot.z0, z1: lot.z1, y0: yS, y1: lot.h, isSetback: true };
    // inset from street sides (and randomly others)
    for (const s of SIDES) {
      if (!(frontSides.has(s) || lot.tower || rng.chance(0.3))) continue;
      if (s === 'nx') up.x0 += ins; else if (s === 'px') up.x1 -= ins; else if (s === 'nz') up.z0 += ins; else up.z1 -= ins;
    }
    if (up.x1 - up.x0 > 5 && up.z1 - up.z0 > 5) vols.push(up); else base.y1 = lot.h;
  } else vols.push(base);
  // upper floors overhanging the street (very common on narrow Japanese lots) -> breaks the flat street wall
  const ovFront = lot.detail === 'hi' && !lot.overlook && lot.fronts.find((f) => !f.lane && f.baseY === 0);
  lot.overhang = 0;
  if (ovFront && rng.chance(0.45) && vols[0].y1 > lot.groundH + 3) {
    const ov = ovFront.district === 'alley' ? rng.range(0.25, 0.5) : rng.range(0.3, 0.65);
    const b0 = vols[0];
    const g = { ...b0, y1: lot.groundH };
    const u = { ...b0, y0: lot.groundH };
    if (ovFront.side === 'nx') u.x0 -= ov; else if (ovFront.side === 'px') u.x1 += ov; else if (ovFront.side === 'nz') u.z0 -= ov; else u.z1 += ov;
    vols.splice(0, 1, g, u);
    lot.overhang = ov; lot.overhangSide = ovFront.side;
  }
  lot.volumes = vols;

  const cxL = (lot.x0 + lot.x1) / 2, czL = (lot.z0 + lot.z1) / 2;
  const fac = B.get(cxL, czL, 'facade', FACADE_ATTRS);
  const frontMap = new Map(lot.fronts.map((f) => [f.side, f]));

  vols.forEach((v, vi) => {
    for (const s of SIDES) {
      const fr = sideFrame(v, s, v.y0);
      if (fr.width < 0.5) continue;
      const front = frontMap.get(s);
      const isFront = !!front || lot.tower || !!v.isSetback || (lot.cover && lot.cover[s] < 0.45);
      let kind = isFront ? kindFront : 3;
      const n = Math.max(1, Math.round(fr.width / (kind === 3 ? bayT * 1.3 : bayT)));
      const bayW = fr.width / n;
      const startY = lot.groundH;
      let y0 = v.y0;
      // shopfront: facade starts above the ground floor (shop module fills below)
      if (vi === 0 && front && front.shop && lot.detail === 'hi' && front.baseY >= 0) y0 = (front.baseY || 0) + lot.groundH;
      if (vi === 0 && front && front.baseY > 0 && !front.shop) y0 = 0;
      const a = {
        aWin: [seed + vi * 0.13 + SIDES.indexOf(s) * 0.031, lot.floorH, bayW, startY],
        aWin2: [wwF, whF, kind === 2 ? litP * 1.3 : litP, kind],
        aWin3: [v.y1 - 0.2, layer, st.texScale, tint],
      };
      lot.sides = lot.sides || {};
      lot.sides[`${vi}:${s}`] = { bayW, n, kind, startY, wwF, whF, y0, y1: v.y1, front: front || null, fr, vi };
      if (v.y1 - y0 > 0.1) fac.vrect([fr.origin[0], y0, fr.origin[2]], fr.right, fr.width, v.y1 - y0, a, 0, y0);
    }
    if (lot.overhang && vi === 0) { out.colliders.push({ x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2, z: (v.z0 + v.z1) / 2, hx: (v.x1 - v.x0) / 2, hy: (v.y1 - v.y0) / 2, hz: (v.z1 - v.z0) / 2 }); return; }
    if (lot.overhang && vi === 1) {
      // soffit under the overhang
      const g0 = vols[0], yy = v.y0 - 0.005;
      const sx0 = v.x0, sx1 = v.x1, sz0 = v.z0, sz1 = v.z1;
      const ta2 = trimAttr(trimLayer, 3, tint, seed);
      const s = lot.overhangSide;
      const r0 = s === 'nx' ? [sx0, g0.x0, sz0, sz1] : s === 'px' ? [g0.x1, sx1, sz0, sz1] : s === 'nz' ? [sx0, sx1, sz0, g0.z0] : [sx0, sx1, g0.z1, sz1];
      fac.quad([r0[0], yy, r0[2]], [r0[1], yy, r0[2]], [r0[1], yy, r0[3]], [r0[0], yy, r0[3]], [r0[0], r0[2]], [r0[1], r0[2]], [r0[1], r0[3]], [r0[0], r0[3]], ta2, [0, -1, 0], [1, 0, 0]);
    }
    // roof
    const ra = { aWin: [seed, 3, 3, 9999], aWin2: [0.5, 0.5, 0, 4], aWin3: [9999, roofLayer, roofLayer === 7 ? 4.5 : 3.5, roofTint] };
    const y = v.y1;
    fac.quad([v.x0, y, v.z1], [v.x1, y, v.z1], [v.x1, y, v.z0], [v.x0, y, v.z0],
      [v.x0, -v.z1], [v.x1, -v.z1], [v.x1, -v.z0], [v.x0, -v.z0], ra, [0, 1, 0], [1, 0, 0]);
    // parapet
    if (!(lot.overlook && vi === vols.length - 1)) {
      const ph = rng.range(0.7, 1.2), pt = 0.22;
      const ta = trimAttr(trimLayer, 3, tint, seed);
      fac.box((v.x0 + v.x1) / 2, y + ph / 2, v.z0 + pt / 2, v.x1 - v.x0, ph, pt, ta);
      fac.box((v.x0 + v.x1) / 2, y + ph / 2, v.z1 - pt / 2, v.x1 - v.x0, ph, pt, ta);
      fac.box(v.x0 + pt / 2, y + ph / 2, (v.z0 + v.z1) / 2, pt, ph, v.z1 - v.z0 - pt * 2, ta);
      fac.box(v.x1 - pt / 2, y + ph / 2, (v.z0 + v.z1) / 2, pt, ph, v.z1 - v.z0 - pt * 2, ta);
      // coping/cornice on street fronts
      for (const f of lot.fronts) {
        if (vi !== vols.length - 1 && !lot.setback) continue;
        const fr = sideFrame(v, f.side, 0);
        const cx = fr.origin[0] + fr.right[0] * fr.width / 2 + fr.normal[0] * 0.08;
        const cz = fr.origin[2] + fr.right[2] * fr.width / 2 + fr.normal[2] * 0.08;
        const along = Math.abs(fr.right[0]) > 0.5;
        fac.box(cx, y + ph + 0.04, cz, along ? fr.width + 0.2 : 0.45, 0.08, along ? 0.45 : fr.width + 0.2, ta);
      }
    }
    out.colliders.push({ x: (v.x0 + v.x1) / 2, y: (v.y0 + v.y1) / 2, z: (v.z0 + v.z1) / 2, hx: (v.x1 - v.x0) / 2, hy: (v.y1 - v.y0) / 2, hz: (v.z1 - v.z0) / 2 });
  });

  // tower crowns: machine rooms, LED bands, aviation lights (skyline silhouettes, avoids flat box tops)
  if (lot.h > 30 && !lot.overlook) {
    const v = vols[vols.length - 1];
    const det = B.get(cxL, czL, 'detail', DETAIL_ATTRS);
    const w = v.x1 - v.x0, d = v.z1 - v.z0;
    if (rng.chance(0.65) && w > 8 && d > 8) {
      const ix = w * rng.range(0.18, 0.3), iz = d * rng.range(0.18, 0.3), mh = rng.range(3.2, 5.5);
      const ta = trimAttr(trimLayer, 3, tint, seed);
      const mx0 = v.x0 + ix, mx1 = v.x1 - ix, mz0 = v.z0 + iz, mz1 = v.z1 - iz;
      fac.box((mx0 + mx1) / 2, v.y1 + mh / 2, (mz0 + mz1) / 2, mx1 - mx0, mh, mz1 - mz0, { aWin: [seed + 0.5, mh, 4, v.y1], aWin2: [0.3, 0.3, 0.1, 3], aWin3: [v.y1 + mh - 0.3, trimLayer, 3, tint] });
      fac.box((mx0 + mx1) / 2, v.y1 + mh + 0.1, (mz0 + mz1) / 2, mx1 - mx0 + 0.3, 0.2, mz1 - mz0 + 0.3, ta);
      out.colliders.push({ x: (mx0 + mx1) / 2, y: v.y1 + mh / 2, z: (mz0 + mz1) / 2, hx: (mx1 - mx0) / 2, hy: mh / 2, hz: (mz1 - mz0) / 2 });
    }
    if (rng.chance(0.35)) {
      const col = rng.pick([[0.6, 0.85, 1.0], [1.0, 0.3, 0.7], [0.3, 1.0, 0.9], [1.0, 0.8, 0.5]]);
      const a = { aCol: [...col, rng.range(1.5, 3.0)], aPbr: [0.5, 0, 0, 0] };
      const y = v.y1 - rng.range(0.4, 1.2), t = 0.08;
      det.box((v.x0 + v.x1) / 2, y, v.z0 - 0.03, w, t, 0.06, a);
      det.box((v.x0 + v.x1) / 2, y, v.z1 + 0.03, w, t, 0.06, a);
      det.box(v.x0 - 0.03, y, (v.z0 + v.z1) / 2, 0.06, t, d, a);
      det.box(v.x1 + 0.03, y, (v.z0 + v.z1) / 2, 0.06, t, d, a);
    }
    if (lot.h > 45) for (const [x, z] of [[v.x0 + 0.3, v.z0 + 0.3], [v.x1 - 0.3, v.z1 - 0.3], [v.x0 + 0.3, v.z1 - 0.3], [v.x1 - 0.3, v.z0 + 0.3]]) {
      det.box(x, v.y1 + 1.3, z, 0.15, 0.15, 0.15, { aCol: [1, 0.08, 0.04, 6], aPbr: [0.5, 0, 0, 0] });
    }
  }
  // floor slab bands / horizontal relief on near street fronts
  if (lot.detail === 'hi' && (kindFront === 0) && rng.chance(0.6)) {
    const ta = trimAttr(trimLayer, 3, tint, seed);
    for (const f of lot.fronts) {
      const v = lot.overhang ? vols[1] : vols[0];
      const fr = sideFrame(v, f.side, 0);
      const along = Math.abs(fr.right[0]) > 0.5;
      for (let i = 1; i < lot.floors; i++) {
        const y = lot.groundH + (i - 1) * lot.floorH + (f.baseY > 0 ? 0 : 0);
        if (y > v.y1 - 0.5) break;
        const cx = fr.origin[0] + fr.right[0] * fr.width / 2 + fr.normal[0] * 0.06;
        const cz = fr.origin[2] + fr.right[2] * fr.width / 2 + fr.normal[2] * 0.06;
        fac.box(cx, y - 0.06, cz, along ? fr.width : 0.12, 0.14, along ? 0.12 : fr.width, ta);
      }
    }
  }
  // vertical corner pilasters on fronts (break flatness)
  if (lot.detail !== 'lo' && rng.chance(0.5)) {
    const ta = trimAttr(trimLayer, 3, tint, seed);
    for (const f of lot.fronts) {
      const v = lot.overhang ? vols[1] : vols[0];
      const fr = sideFrame(v, f.side, 0);
      const y0 = lot.groundH, h = v.y1 - y0;
      if (h < 2) continue;
      for (const t of [0.18, fr.width - 0.18]) {
        const px = fr.origin[0] + fr.right[0] * t + fr.normal[0] * 0.1;
        const pz = fr.origin[2] + fr.right[2] * t + fr.normal[2] * 0.1;
        fac.box(px, y0 + h / 2, pz, 0.36, h, 0.36, ta);
      }
    }
  }
}
