// Facade & roof props: AC condensers (Blender GLB, instanced), water tanks (instanced), balconies with clutter,
// drainpipes, utility pipes, roof stair houses, antennas, dishes, billboard frames, roof fences, vending machines,
// ground-floor doors/shutters on non-shop fronts, wall posters.
import * as THREE from 'three/webgpu';
import {
  vec2, vec3, vec4, float, mix, smoothstep, fract, length, abs, atan, positionGeometry, positionWorld, step, sin, min,
} from 'three/tsl';
import { mulberry32 } from './rng.js';
import { STYLES } from './plan.js';
import { FACADE_ATTRS, DETAIL_ATTRS, trimAttr, SIDES } from './architecture.js';
import { slotUV } from './shops.js';
import { vnoise } from './materials.js';

const D = (col, em = 0, rough = 0.6, metal = 0, grime = 0.5) => ({ aCol: [col[0], col[1], col[2], em], aPbr: [rough, metal, 0, grime] });
const PIPE_GREY = [0.55, 0.55, 0.52], PIPE_DARK = [0.12, 0.12, 0.12], STEEL = [0.3, 0.3, 0.3], RUST = [0.32, 0.18, 0.1];
const LAUNDRY = [[0.85, 0.85, 0.82], [0.2, 0.3, 0.55], [0.7, 0.2, 0.2], [0.9, 0.75, 0.4], [0.3, 0.5, 0.35], [0.15, 0.15, 0.15], [0.85, 0.55, 0.65]];

function makeACMaterials(wetness) {
  const body = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const n = vnoise(vec2(P.x.add(P.z).mul(6.0), P.y.mul(6.0)));
  body.colorNode = vec4(vec3(0.74, 0.73, 0.68).mul(mix(0.5, 1.0, n)), 1);
  body.roughnessNode = mix(float(0.55), float(0.3), wetness);
  body.metalnessNode = float(0.2);
  const dark = new THREE.MeshStandardNodeMaterial();
  // procedural fan grille: concentric rings + spokes around the fan centre (local coords from the GLB)
  const q = positionGeometry.xy.sub(vec2(-0.12, 0.34));
  const r = length(q);
  const ring = smoothstep(0.25, 0.1, abs(fract(r.div(0.034)).sub(0.5)));
  const ang = atan(q.y, q.x);
  const spoke = smoothstep(0.06, 0.0, abs(fract(ang.div(1.5708).add(0.5)).sub(0.5)).mul(r).mul(6.0));
  const g = ring.max(spoke).mul(step(r, 0.232));
  dark.colorNode = vec4(mix(vec3(0.015), vec3(0.6, 0.6, 0.57), g), 1);
  dark.roughnessNode = mix(float(0.8), float(0.4), g);
  dark.metalnessNode = g.mul(0.5);
  return { ac_body: body, ac_dark: dark };
}

function makeTankMaterials(wetness) {
  const tank = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const n = vnoise(vec2(P.x.add(P.z).mul(2.0), P.y.mul(3.0)));
  const streak = vnoise(vec2(P.x.add(P.z).mul(14.0), P.y.mul(0.8)));
  tank.colorNode = vec4(vec3(0.66, 0.68, 0.62).mul(mix(0.45, 1.0, n)).mul(mix(1.0, 0.7, smoothstep(0.5, 0.8, streak))), 1);
  tank.roughnessNode = mix(float(0.6), float(0.28), wetness);
  const steel = new THREE.MeshStandardNodeMaterial();
  steel.colorNode = vec4(vec3(0.16, 0.15, 0.14).mul(mix(0.6, 1.3, n)), 1);
  steel.roughnessNode = float(0.45);
  steel.metalnessNode = float(0.7);
  return { tank, ptank: tank, stand: steel, pstand: steel, steel, psteel: steel };
}

async function loadPrimitives(ctx, path) {
  const g = await ctx.assets.gltf(path);
  if (!g) return [];
  const prims = [];
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const geo = o.geometry.clone();
    geo.applyMatrix4(o.matrixWorld);
    prims.push({ geo, matName: o.material?.name || '' });
  });
  return prims;
}

export async function buildProps(ctx, lots, B, out, { wetness }) {
  const rng = mulberry32(0x5EED);
  const acM = [], tankM = [], ptankM = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), pv = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const place = (arr, x, y, z, rotY, s = 1) => {
    q.setFromAxisAngle(up, rotY); sc.set(s, s, s); pv.set(x, y, z);
    arr.push(m4.clone().compose(pv, q, sc));
  };
  const rotFor = (n) => Math.atan2(n[0], n[2]);
  const wallPt = (fr, s, y, off = 0) => [fr.origin[0] + fr.right[0] * s + fr.normal[0] * off, y, fr.origin[2] + fr.right[2] * s + fr.normal[2] * off];

  for (const lot of lots) {
    if (!lot.sides) continue;
    const st = STYLES[lot.style];
    const r = mulberry32((lot.id * 2654435761) >>> 0);
    const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
    const det = B.get(cx, cz, 'detail', DETAIL_ATTRS);
    const fac = B.get(cx, cz, 'facade', FACADE_ATTRS);
    const near = lot.detail !== 'lo';
    const hi = lot.detail === 'hi';
    const trim = trimAttr(lot.wallLayer ?? 1, 3, 0.5, lot.seed);
    const pipeCol = r.chance(0.6) ? PIPE_GREY : PIPE_DARK;

    for (const key in lot.sides) {
      const sd = lot.sides[key];
      const { fr, bayW, n, startY, front, vi } = sd;
      const rot = rotFor(fr.normal);
      const floorsHere = Math.floor((sd.y1 - 0.6 - Math.max(startY, sd.y0)) / lot.floorH);
      const iy0 = Math.max(0, Math.ceil((sd.y0 - startY) / lot.floorH));
      if (!near && vi === 0) {
        // far: only occasional AC columns on side walls to break silhouettes
        continue;
      }
      const isFrontish = !!front || lot.tower || vi > 0;
      const balcony = hi && front && !front.lane && st.balcony > 0 && ((lot.seed * 97) % 1) < st.balcony && fr.width > 5;
      const shopBelow = front && front.shop && hi;

      // ---------- balconies ----------
      if (balcony) {
        const bd = r.range(0.9, 1.3);
        const ptype = r.weighted([['solid', 2], ['rail', 2], ['frost', 1]]);
        const partEvery = r.chance(0.5) ? 2 : 1;
        for (let iy = shopBelow ? 1 : iy0; iy < iy0 + floorsHere; iy++) {
          const y = startY + iy * lot.floorH;
          if (y < sd.y0 + 0.5) continue;
          const sMid = fr.width / 2;
          const slabC = wallPt(fr, sMid, y - 0.08, bd / 2);
          fac.box(slabC[0], slabC[1], slabC[2], ...dims(fr, fr.width - 0.3, 0.16, bd), trim);
          // parapet
          const pc = wallPt(fr, sMid, y + 0.5, bd - 0.05);
          if (ptype === 'solid') fac.box(pc[0], pc[1], pc[2], ...dims(fr, fr.width - 0.3, 1.0, 0.1), trim);
          else if (ptype === 'frost') {
            const gq = B.get(cx, cz, 'detail', DETAIL_ATTRS);
            gq.box(pc[0], pc[1] - 0.05, pc[2], ...dims(fr, fr.width - 0.4, 0.85, 0.03), D([0.55, 0.6, 0.62], 0.0, 0.15, 0.0, 0.2));
            const tp = wallPt(fr, sMid, y + 1.0, bd - 0.05);
            det.box(tp[0], tp[1], tp[2], ...dims(fr, fr.width - 0.3, 0.05, 0.07), D(STEEL, 0, 0.35, 0.8));
          } else {
            for (const hh of [0.98, 0.6, 0.25]) {
              const a = wallPt(fr, 0.2, y + hh, bd - 0.05), b = wallPt(fr, fr.width - 0.2, y + hh, bd - 0.05);
              det.beam(a, b, hh > 0.9 ? 0.05 : 0.025, D(STEEL, 0, 0.35, 0.8, 0.4));
            }
            for (let s = 0.2; s <= fr.width - 0.1; s += 1.1) {
              det.beam(wallPt(fr, s, y, bd - 0.05), wallPt(fr, s, y + 1.0, bd - 0.05), 0.035, D(STEEL, 0, 0.35, 0.8, 0.4));
            }
          }
          // partitions
          for (let k = partEvery; k < n; k += partEvery) {
            const pp = wallPt(fr, k * bayW, y + 1.2, bd / 2);
            fac.box(pp[0], pp[1], pp[2], ...dims(fr, 0.06, 2.4, bd), trim);
          }
          // clutter per unit
          for (let k = 0; k < n; k += partEvery) {
            const s0 = k * bayW, s1 = Math.min(n, k + partEvery) * bayW;
            const u = r();
            if (u < 0.45) {
              const s = r.chance(0.5) ? s0 + 0.55 : s1 - 0.55;
              const p = wallPt(fr, s, y, 0.05);
              place(acM, p[0], p[1], p[2], rot);
            }
            if (r.chance(0.35)) { // laundry
              const pa = wallPt(fr, s0 + 0.3, y + 2.1, bd * 0.6), pb = wallPt(fr, s1 - 0.3, y + 2.1, bd * 0.6);
              det.beam(pa, pb, 0.02, D(STEEL, 0, 0.4, 0.8));
              let s = s0 + 0.4;
              while (s < s1 - 0.6) {
                const w = r.range(0.3, 0.7), h = r.range(0.4, 0.9);
                const c = r.pick(LAUNDRY);
                const q0 = wallPt(fr, s, y + 2.08 - h, bd * 0.6 + 0.01), q1 = wallPt(fr, s + w, y + 2.08 - h, bd * 0.6 + 0.01);
                const q2 = wallPt(fr, s + w, y + 2.08, bd * 0.6 + 0.01), q3 = wallPt(fr, s, y + 2.08, bd * 0.6 + 0.01);
                det.quad(q0, q1, q2, q3, [0, 0], [1, 0], [1, 1], [0, 1], D(c, 0.0, 0.9, 0, 0.3));
                det.quad(q1, q0, q3, q2, [0, 0], [1, 0], [1, 1], [0, 1], D(c, 0.0, 0.9, 0, 0.3));
                s += w + r.range(0.05, 0.3);
              }
            }
            if (r.chance(0.3)) { // plants / storage box
              const s = r.range(s0 + 0.4, s1 - 0.4);
              const p = wallPt(fr, s, y + 0.3, bd - 0.35);
              det.box(p[0], p[1], p[2], ...dims(fr, 0.45, 0.6, 0.35), r.chance(0.5) ? D([0.1, 0.2, 0.07], 0, 0.6) : D([0.6, 0.55, 0.45], 0, 0.7));
            }
            if (r.chance(0.12)) { // balcony ceiling light
              const p = wallPt(fr, (s0 + s1) / 2, y + lot.floorH - 0.25, 0.4);
              det.box(p[0], p[1], p[2], ...dims(fr, 0.25, 0.06, 0.12), D([1, 0.8, 0.55], 3, 0.5));
            }
          }
        }
      } else if (near && isFrontish) {
        // ---------- AC units hung below windows between bays ----------
        const pAC = (st.ac || 0.3) * (sd.kind === 3 ? 0.0 : (front && front.district === 'alley' ? 0.6 : 0.24));
        for (let iy = iy0; iy < iy0 + floorsHere; iy++) {
          const y = startY + iy * lot.floorH + 0.08;
          if (y < sd.y0 + 0.2) continue;
          for (let ix = 0; ix < n; ix++) {
            if (!r.chance(pAC)) continue;
            const s = (ix + 0.5) * bayW + (r.chance(0.5) ? -1 : 1) * Math.max(0, bayW * 0.5 - 0.45);
            if (s < 0.5 || s > fr.width - 0.5) continue;
            const p = wallPt(fr, s, y, 0.02);
            place(acM, p[0], p[1], p[2], rot);
            // bracket
            for (const o of [-0.3, 0.3]) det.beam(wallPt(fr, s + o, y - 0.02, 0.0), wallPt(fr, s + o, y - 0.02, 0.34), 0.03, D(RUST, 0, 0.6, 0.5));
            // drain hose down the wall
            if (r.chance(0.5)) det.beam(wallPt(fr, s + 0.42, y + 0.15, 0.03), wallPt(fr, s + 0.42, y - r.range(0.5, 2.0), 0.03), 0.018, D(PIPE_DARK, 0, 0.5));
          }
        }
      }

      // ---------- side walls (party walls): AC stacks + pipes ----------
      if (near && sd.kind === 3 && !balcony) {
        const cols = r.int(0, 2);
        for (let c = 0; c < cols; c++) {
          const s = r.range(0.8, fr.width - 0.8);
          for (let iy = iy0; iy < iy0 + floorsHere; iy++) {
            if (!r.chance(0.55)) continue;
            const y = startY + iy * lot.floorH + 0.1;
            if (y < sd.y0 + 0.2) continue;
            const p = wallPt(fr, s, y, 0.02);
            place(acM, p[0], p[1], p[2], rot);
            for (const o of [-0.3, 0.3]) det.beam(wallPt(fr, s + o, y - 0.02, 0.0), wallPt(fr, s + o, y - 0.02, 0.34), 0.03, D(RUST, 0, 0.6, 0.5));
          }
          // refrigerant pipe bundle going up beside the stack
          det.cyl(wallPt(fr, s + 0.55, 0.5 + sd.y0, 0.08), wallPt(fr, s + 0.55, sd.y1 - 0.3, 0.08), 0.05, D([0.75, 0.73, 0.66], 0, 0.6, 0, 0.7));
        }
        if (r.chance(0.6)) {
          const s = r.range(0.4, fr.width - 0.4);
          det.cyl(wallPt(fr, s, sd.y0, 0.1), wallPt(fr, s, sd.y1, 0.1), 0.06, D(pipeCol, 0, 0.45, 0.2, 0.6));
          if (r.chance(0.5)) det.cyl(wallPt(fr, s + 0.18, sd.y0, 0.08), wallPt(fr, s + 0.18, sd.y1 * 0.7, 0.08), 0.035, D(RUST, 0, 0.5, 0.5, 0.6));
        }
      }

      // ---------- drainpipe on fronts ----------
      if (near && front && r.chance(0.75)) {
        const s = r.chance(0.5) ? 0.22 : fr.width - 0.22;
        const yb = front.baseY > 0 ? front.baseY : 0;
        const po = front.shopType ? 0.28 : 0.12;
        det.cyl(wallPt(fr, s, yb + 0.05, po), wallPt(fr, s, sd.y1 + 0.3, po), 0.055, D(pipeCol, 0, 0.4, 0.15, 0.6), 8);
        // brackets
        for (let y = yb + 1.5; y < sd.y1; y += 2.2) det.box(...wallPt(fr, s, y, 0.07), ...dims(fr, 0.14, 0.04, 0.12), D(STEEL, 0, 0.5, 0.6));
        // gutter head
        det.box(...wallPt(fr, s, sd.y1 + 0.35, 0.14), ...dims(fr, 0.22, 0.18, 0.2), D(pipeCol, 0, 0.4, 0.15, 0.6));
        // gas meter + pipes at street level
        if (hi && !front.shop && r.chance(0.5)) {
          const s2 = s < 1 ? 0.7 : fr.width - 0.7;
          det.box(...wallPt(fr, s2, yb + 1.6, 0.1), ...dims(fr, 0.32, 0.4, 0.18), D([0.68, 0.66, 0.6], 0, 0.5, 0.3, 0.8));
          det.cyl(wallPt(fr, s2, yb + 0.1, 0.07), wallPt(fr, s2, yb + 1.4, 0.07), 0.025, D([0.75, 0.65, 0.2], 0, 0.5, 0.4, 0.7));
        }
      }

      // ---------- ground floor of non-shop fronts: shutters / doors ----------
      if (near && front && !(front.shop && hi) && vi === 0 && front.baseY >= 0 && fr.width > 3) {
        const yb = front.baseY > 0 ? front.baseY : 0;
        let s = r.range(0.3, 1.0);
        while (s < fr.width - 1.2) {
          const kind = r.weighted([['shutter', 3], ['door', 2], ['wall', 2]]);
          const w = kind === 'door' ? 1.0 : Math.min(r.range(2.2, 4.0), fr.width - s - 0.3);
          if (w < 0.9) break;
          if (kind === 'shutter') {
            const h = Math.min(lot.groundH - 0.6, 3.0);
            const sub = [r.range(0, 0.5), 0, 0.5, 1];
            const p0 = wallPt(fr, s, yb, 0.03), p1 = wallPt(fr, s + w, yb, 0.03), p2 = wallPt(fr, s + w, yb + h, 0.03), p3 = wallPt(fr, s, yb + h, 0.03);
            const u = (a, b) => slotUV('shutter', a, b, sub);
            det.quad(p0, p1, p2, p3, u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [0.8, 0.8, 0.8, 0], aPbr: [0.5, 0.2, 1, 0.3] });
            det.box(...wallPt(fr, s + w / 2, yb + h + 0.15, 0.15), ...dims(fr, w + 0.1, 0.3, 0.3), D([0.4, 0.4, 0.38], 0, 0.5, 0.4, 0.8));
          } else if (kind === 'door') {
            const p = wallPt(fr, s + w / 2, yb + 1.05, 0.04);
            det.box(p[0], p[1], p[2], ...dims(fr, w, 2.1, 0.06), D(r.pick([[0.25, 0.25, 0.27], [0.3, 0.18, 0.1], [0.5, 0.5, 0.48]]), 0, 0.4, 0.5, 0.6));
            det.box(...wallPt(fr, s + w / 2, yb + 2.15, 0.08), ...dims(fr, w + 0.15, 0.08, 0.1), D(STEEL, 0, 0.4, 0.6));
            // door light
            det.box(...wallPt(fr, s + w / 2, yb + 2.45, 0.1), ...dims(fr, 0.2, 0.12, 0.12), D([1, 0.85, 0.6], r.chance(0.6) ? 2.5 : 0.05, 0.5));
            // intercom / mailbox
            det.box(...wallPt(fr, s + w + 0.25, yb + 1.3, 0.05), ...dims(fr, 0.25, 0.35, 0.06), D([0.6, 0.6, 0.6], 0, 0.4, 0.5));
          }
          // posters
          if (r.chance(0.35)) {
            const ps = s + w + 0.15;
            if (ps < fr.width - 0.8) poster(det, fr, ps, yb + r.range(1.0, 1.4), r, wallPt);
          }
          s += w + r.range(0.3, 1.2);
        }
      }
      // posters on shop pillars / alley walls
      if (hi && front && r.chance(0.5)) {
        const yb = front.baseY > 0 ? front.baseY : 0;
        const sh = front.shop && f0shop(lot, front);
        poster(det, fr, r.chance(0.5) ? 0.02 : fr.width - (sh ? 0.32 : 0.62), yb + r.range(0.9, 1.5), r, wallPt, sh ? 0.3 : 0.6, sh ? 0.2 : 0);
      }
    }

    // ---------- roof ----------
    const top = lot.volumes[lot.volumes.length - 1];
    if (lot.overlook) continue;
    const rx0 = top.x0 + 0.8, rx1 = top.x1 - 0.8, rz0 = top.z0 + 0.8, rz1 = top.z1 - 0.8;
    if (rx1 - rx0 < 1.5 || rz1 - rz0 < 1.5) continue;
    const ry = top.y1;
    const rp = () => [r.range(rx0, rx1), r.range(rz0, rz1)];
    const nAC = near ? r.int(1, 5) : r.int(0, 2);
    for (let i = 0; i < nAC; i++) { const [x, z] = rp(); place(acM, x, ry, z, r.int(0, 3) * Math.PI / 2); }
    if (r.chance(near ? 0.4 : 0.2)) {
      const [x, z] = rp();
      if (r.chance(0.5)) place(tankM, x, ry, z, r() * 6.28, r.range(0.8, 1.15));
      else if (rx1 - rx0 > 4 && rz1 - rz0 > 3) place(ptankM, (rx0 + rx1) / 2, ry, (rz0 + rz1) / 2, r.int(0, 3) * Math.PI / 2, 1);
    }
    if (r.chance(near ? 0.45 : 0.25) && rx1 - rx0 > 3.5 && rz1 - rz0 > 3.5) {
      // stair / elevator house
      const w = 2.4, d = 2.8, h = r.range(2.6, 3.4);
      const x = r.chance(0.5) ? rx0 + w / 2 : rx1 - w / 2, z = r.chance(0.5) ? rz0 + d / 2 : rz1 - d / 2;
      fac.box(x, ry + h / 2, z, w, h, d, trim);
      fac.box(x, ry + h + 0.05, z, w + 0.2, 0.1, d + 0.2, trim);
    }
    if (r.chance(near ? 0.5 : 0.25)) {
      // antenna mast with yagi crossbars
      const [x, z] = rp();
      const h = r.range(2.5, 6);
      det.cyl([x, ry, z], [x, ry + h, z], 0.035, D(STEEL, 0, 0.4, 0.8), 5);
      for (let k = 0; k < r.int(1, 3); k++) {
        const yy = ry + h - 0.3 - k * 0.7, a = r() * 3.14, l = r.range(0.8, 1.6);
        det.beam([x - Math.cos(a) * l / 2, yy, z - Math.sin(a) * l / 2], [x + Math.cos(a) * l / 2, yy, z + Math.sin(a) * l / 2], 0.02, D(STEEL, 0, 0.4, 0.8));
      }
      if (r.chance(0.5)) det.box(x, ry + h + 0.05, z, 0.08, 0.1, 0.08, D([1, 0.1, 0.05], 4, 0.5)); // aviation light
    }
    if (near && r.chance(0.3)) {
      // satellite dish
      const [x, z] = rp(); const a = r() * 6.28;
      const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.9, a, 0, 'YXZ')).setPosition(x, ry + 0.9, z);
      det.geometry(dishGeo(), m, D([0.8, 0.8, 0.78], 0, 0.5, 0.2, 0.6));
      det.cyl([x, ry, z], [x, ry + 0.85, z], 0.03, D(STEEL, 0, 0.4, 0.8));
    }
    if (near && r.chance(0.25)) {
      // roof safety fence
      const fh = 1.6;
      const ptsF = [[top.x0 + 0.3, top.z0 + 0.3], [top.x1 - 0.3, top.z0 + 0.3], [top.x1 - 0.3, top.z1 - 0.3], [top.x0 + 0.3, top.z1 - 0.3], [top.x0 + 0.3, top.z0 + 0.3]];
      for (let i = 0; i < 4; i++) {
        const [ax, az] = ptsF[i], [bx, bz] = ptsF[i + 1];
        for (const hh of [fh, fh * 0.5]) det.beam([ax, ry + hh, az], [bx, ry + hh, bz], 0.03, D([0.25, 0.27, 0.25], 0, 0.4, 0.7));
        const len = Math.hypot(bx - ax, bz - az), nn = Math.ceil(len / 2);
        for (let k = 0; k < nn; k++) { const t = k / nn; det.beam([ax + (bx - ax) * t, ry, az + (bz - az) * t], [ax + (bx - ax) * t, ry + fh, az + (bz - az) * t], 0.04, D([0.25, 0.27, 0.25], 0, 0.4, 0.7)); }
      }
    }
    // billboard frame on avenue-facing roofs
    const avFront = lot.fronts.find((f) => f.district === 'avenue' || (f.district === 'cross' && !f.lane));
    if (avFront && hi && r.chance(0.28) && lot.h < 40) {
      const v = lot.volumes[lot.volumes.length - 1];
      const fr = sideFrameOf(v, avFront.side);
      const bw = Math.min(fr.width - 1, r.range(5, 9)), bh = bw * r.range(0.4, 0.55);
      const y0 = ry + 1.5;
      const sMid = fr.width / 2;
      const steel = D([0.12, 0.12, 0.12], 0, 0.45, 0.8, 0.6);
      for (const s of [sMid - bw / 2 + 0.3, sMid + bw / 2 - 0.3]) {
        det.beam(wallPt(fr, s, ry, -1.2), wallPt(fr, s, y0 + bh, -0.5), 0.12, steel);
        det.beam(wallPt(fr, s, ry, -3.0), wallPt(fr, s, y0 + bh * 0.6, -0.6), 0.08, steel);
      }
      for (let k = 0; k <= 3; k++) det.beam(wallPt(fr, sMid - bw / 2, y0 + bh * k / 3, -0.6), wallPt(fr, sMid + bw / 2, y0 + bh * k / 3, -0.6), 0.06, steel);
      // panel (poster art, lit by small lamps)
      const cell = r.int(0, 15);
      const sub = [(cell % 4) * 0.25, Math.floor(cell / 4) * 0.25, 0.25, 0.25];
      const p0 = wallPt(fr, sMid - bw / 2, y0, -0.45), p1 = wallPt(fr, sMid + bw / 2, y0, -0.45), p2 = wallPt(fr, sMid + bw / 2, y0 + bh, -0.45), p3 = wallPt(fr, sMid - bw / 2, y0 + bh, -0.45);
      const u = (a, b) => slotUV('posters', a, b, sub);
      det.quad(p0, p1, p2, p3, u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [1, 1, 1, r.range(0.5, 1.0)], aPbr: [0.5, 0, 1, 0] });
      for (let s = sMid - bw / 2 + 0.6; s < sMid + bw / 2; s += 1.6) {
        det.beam(wallPt(fr, s, y0 - 0.1, -0.45), wallPt(fr, s, y0 - 0.1, 0.4), 0.03, steel);
        det.box(...wallPt(fr, s, y0 - 0.12, 0.45), 0.18, 0.08, 0.18, D([1, 0.95, 0.85], 4, 0.5));
      }
    }
  }

  // ---------- vending machines at shop fronts ----------
  for (const lot of lots) {
    if (lot.detail !== 'hi') continue;
    for (const f of lot.fronts) {
      if (!f.shopType || f.shopType === 'pachinko') continue;
      const r = mulberry32((lot.id * 7 + f.side.length * 131 + 99) >>> 0);
      if (!r.chance(f.district === 'alley' ? 0.3 : 0.22)) continue;
      const sd = lot.sides[`0:${f.side}`];
      if (!sd) continue;
      const fr = sd.fr;
      const yb = f.baseY > 0 ? f.baseY : 0;
      const n = r.chance(0.3) ? 2 : 1;
      for (let k = 0; k < n; k++) {
        const s = (r.chance(0.5) ? 0.55 : fr.width - 0.55) + (k ? (r.chance(0.5) ? 1 : -1) * 0.98 : 0);
        if (s < 0.4 || s > fr.width - 0.4) continue;
        const cx = (lot.x0 + lot.x1) / 2, cz = (lot.z0 + lot.z1) / 2;
        const det = B.get(cx, cz, 'detail', DETAIL_ATTRS);
        const body = r.pick([[0.85, 0.85, 0.83], [0.7, 0.08, 0.06], [0.08, 0.2, 0.55], [0.15, 0.15, 0.16]]);
        const c = wallPt(fr, s, yb + 0.93, 0.4);
        det.box(c[0], c[1], c[2], ...dims(fr, 0.95, 1.86, 0.75), D(body, 0.02, 0.35, 0.3, 0.5));
        const p0 = wallPt(fr, s - 0.42, yb + 0.12, 0.78), p1 = wallPt(fr, s + 0.42, yb + 0.12, 0.78);
        const p2 = wallPt(fr, s + 0.42, yb + 1.78, 0.78), p3 = wallPt(fr, s - 0.42, yb + 1.78, 0.78);
        const u = (a, b) => slotUV('vending', a, b);
        det.quad(p0, p1, p2, p3, u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [1, 1, 1, 1.15], aPbr: [0.2, 0, 1, 0] });
        // side panels: ad wrap / stickers so the side view isn't a blank box
        for (const sgn of [-1, 1]) {
          const cell = r.int(0, 15);
          const sub = [(cell % 4) * 0.25 + 0.02, Math.floor(cell / 4) * 0.25 + 0.02, 0.21, 0.21];
          const ss = s + sgn * 0.48;
          const a0 = wallPt(fr, ss, yb + 0.25, sgn > 0 ? 0.72 : 0.08), a1 = wallPt(fr, ss, yb + 0.25, sgn > 0 ? 0.08 : 0.72);
          const a2 = [a1[0], yb + 1.7, a1[2]], a3 = [a0[0], yb + 1.7, a0[2]];
          const uu = (x, y) => slotUV('posters', x, y, sub);
          det.quad(a0, a1, a2, a3, uu(0, 0), uu(1, 0), uu(1, 1), uu(0, 1), { aCol: [0.9, 0.9, 0.9, 0.12], aPbr: [0.3, 0, 1, 0.3] });
        }
        det.box(...wallPt(fr, s, yb + 1.83, 0.77), ...dims(fr, 0.9, 0.08, 0.02), D([1, 1, 1], 1.5, 0.3));
        out.colliders.push({ x: c[0], y: c[1], z: c[2], hx: Math.abs(fr.right[0]) * 0.47 + Math.abs(fr.normal[0]) * 0.37, hy: 0.93, hz: Math.abs(fr.right[2]) * 0.47 + Math.abs(fr.normal[2]) * 0.37 });
        // recycle bin
        if (k === 0 && r.chance(0.7)) {
          const b = wallPt(fr, s + (s < 1 ? 0.75 : -0.75), yb + 0.4, 0.3);
          det.box(b[0], b[1], b[2], ...dims(fr, 0.4, 0.8, 0.4), D([0.15, 0.3, 0.6], 0, 0.4, 0.1, 0.6));
        }
      }
      out.lights.push({ pos: wallPt(fr, fr.width / 2, yb + 1.2, 1.4), color: [0.85, 0.92, 1.0], intensity: 1.5, distance: 5, minor: true });
    }
  }

  // ---------- sidewalk clutter in front of near facades (trash bags, A-frame boards, bikes, plants, crates) ----------
  for (const lot of lots) {
    if (lot.detail !== 'hi') continue;
    for (const f of lot.fronts) {
      if (f.baseY < 0) continue;
      const sd = lot.sides[`0:${f.side}`];
      if (!sd) continue;
      const fr = sd.fr;
      const r = mulberry32((lot.id * 31337 + f.side.charCodeAt(1)) >>> 0);
      const yb = f.baseY > 0 ? f.baseY : 0;
      const det = B.get((lot.x0 + lot.x1) / 2, (lot.z0 + lot.z1) / 2, 'detail', DETAIL_ATTRS);
      const maxOut = f.district === 'alley' ? 0.55 : 1.1;
      const items = r.int(0, f.district === 'alley' ? 3 : 2);
      for (let i = 0; i < items; i++) {
        const s = r.range(0.6, fr.width - 0.6);
        const kind = r.weighted([['bags', 3], ['board', f.shopType && f.shopType !== 'shutter' ? 3 : 0.2], ['bike', 1.5], ['plant', 1.5], ['crates', f.district === 'alley' ? 2 : 0.6], ['cone', 0.5]]);
        if (kind === 'bags') {
          const n = r.int(2, 6);
          for (let k = 0; k < n; k++) {
            const p = wallPt(fr, s + r.range(-0.5, 0.5), yb + 0.22, r.range(0.25, 0.7));
            const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromEuler(new THREE.Euler(r() * 0.5, r() * 6.28, r() * 0.5)), new THREE.Vector3(r.range(0.8, 1.2), r.range(0.7, 1.0), r.range(0.8, 1.1)));
            det.geometry(bagGeo(), m, D(r.chance(0.6) ? [0.03, 0.03, 0.035] : [0.55, 0.6, 0.65], 0, 0.18, 0, 0.1));
          }
        } else if (kind === 'board') {
          // A-frame menu board with poster art on both faces
          const cell = r.int(0, 15);
          const sub = [(cell % 4) * 0.25, Math.floor(cell / 4) * 0.25, 0.25, 0.25];
          const u = (a, b) => slotUV('posters', a, b, sub);
          const d0 = Math.min(maxOut, 0.9);
          const top = wallPt(fr, s, yb + 1.0, d0), b0 = wallPt(fr, s, yb, d0 - 0.3), b1 = wallPt(fr, s, yb, d0 + 0.3);
          const hw = 0.3;
          const off = (p, k) => [p[0] + fr.right[0] * k, p[1], p[2] + fr.right[2] * k];
          const em = r.chance(0.5) ? 0.5 : 0.05;
          // outward-facing face
          det.quad(off(b1, -hw), off(b1, hw), off(top, hw), off(top, -hw), u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [1, 1, 1, em], aPbr: [0.4, 0, 1, 0.2] });
          det.quad(off(b0, hw), off(b0, -hw), off(top, -hw), off(top, hw), u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [1, 1, 1, em], aPbr: [0.4, 0, 1, 0.2] });
          if (em > 0.3) out.lights.push({ pos: wallPt(fr, s, yb + 0.6, d0 + 0.6), color: [1, 0.9, 0.8], intensity: 0.8, distance: 3, minor: true });
        } else if (kind === 'bike') {
          const p = wallPt(fr, s, yb, Math.min(maxOut, 0.6));
          const rot = Math.atan2(-fr.right[2], fr.right[0]);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(...p), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rot + r.range(-0.2, 0.2)), new THREE.Vector3(1, 1, 1));
          bike(det, m, r.pick([[0.6, 0.05, 0.05], [0.1, 0.1, 0.1], [0.75, 0.75, 0.75], [0.1, 0.3, 0.5]]));
        } else if (kind === 'plant') {
          const p = wallPt(fr, s, yb, 0.35);
          det.cyl([p[0], yb, p[2]], [p[0], yb + 0.45, p[2]], 0.22, D([0.35, 0.22, 0.15], 0, 0.6, 0, 0.6), 8);
          const m = new THREE.Matrix4().compose(new THREE.Vector3(p[0], yb + 0.8, p[2]), new THREE.Quaternion(), new THREE.Vector3(0.9, 1.1, 0.9));
          det.geometry(bagGeo(), m, D([0.06, 0.13, 0.04], 0, 0.5, 0, 0.3));
        } else if (kind === 'crates') {
          const p = wallPt(fr, s, yb, 0.3);
          const col = r.pick([[0.7, 0.1, 0.08], [0.1, 0.35, 0.15], [0.75, 0.6, 0.1]]);
          const n = r.int(1, 4);
          for (let k = 0; k < n; k++) {
            det.box(p[0], yb + 0.15 + k * 0.3, p[2], 0.45, 0.28, 0.45, D(col, 0.0, 0.35, 0, 0.5));
            det.box(p[0], yb + 0.27 + k * 0.3, p[2], 0.38, 0.06, 0.38, D([0.1, 0.05, 0.02], 0, 0.2, 0, 0.1));
          }
        } else {
          const p = wallPt(fr, s, yb, Math.min(maxOut, 0.8));
          det.cyl([p[0], yb, p[2]], [p[0], yb + 0.7, p[2]], 0.12, D([1, 0.35, 0.05], 0.05, 0.4, 0, 0.3), 8, 0.02);
        }
      }
    }
  }

  // ---------- instanced meshes ----------
  const meshes = [];
  const acPrims = await loadPrimitives(ctx, 'models/buildings/ac_unit.glb');
  const tankPrims = await loadPrimitives(ctx, 'models/buildings/water_tank.glb');
  const ptankPrims = await loadPrimitives(ctx, 'models/buildings/panel_tank.glb');
  const acMats = makeACMaterials(wetness);
  const tankMats = makeTankMaterials(wetness);
  const mk = (prims, mats, list, fallback) => {
    if (!list.length) return;
    for (const p of prims) {
      const im = new THREE.InstancedMesh(p.geo, mats[p.matName] || fallback, list.length);
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      im.frustumCulled = false; // spans the whole city; GPU handles it
      meshes.push(im);
    }
  };
  mk(acPrims, acMats, acM, acMats.ac_body);
  mk(tankPrims, tankMats, tankM, tankMats.tank);
  mk(ptankPrims, tankMats, ptankM, tankMats.tank);

  // ---------- ArtForge 3D PBR Jiangnan Night-Market Stalls (片儿川面摊) ----------
  try {
    const stallGltf = await ctx.assets.gltf('models/buildings/noodle_stall.glb');
    if (stallGltf?.scene) {
      stallGltf.scene.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(stallGltf.scene);
      const sz = new THREE.Vector3(), ctr = new THREE.Vector3();
      box.getSize(sz); box.getCenter(ctr);
      const targetH = 2.35;
      const scale = targetH / Math.max(sz.y, 0.01);
      const stallSpots = [
        { x: -8.75, y: 0.15, z: 11.5, yaw: -Math.PI * 0.38 },
        { x:  8.75, y: 0.15, z: -6.0, yaw:  Math.PI * 0.38 },
        { x: -8.75, y: 0.15, z: -38.0, yaw: -Math.PI * 0.42 },
        { x:  8.75, y: 0.15, z: -86.0, yaw:  Math.PI * 0.42 },
        { x: -8.75, y: 0.15, z: -132.0, yaw: -Math.PI * 0.38 },
        { x: 133.5, y: 0.0, z: -52.0, yaw: -Math.PI * 0.5 },
      ];
      for (const sp of stallSpots) {
        const wrap = new THREE.Group();
        const clone = stallGltf.scene.clone(true);
        clone.scale.setScalar(scale);
        clone.position.set(-ctr.x * scale, -box.min.y * scale, -ctr.z * scale);
        clone.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = true;
          }
        });
        wrap.add(clone);
        wrap.position.set(sp.x, sp.y, sp.z);
        wrap.rotation.y = sp.yaw;
        wrap.updateMatrix();
        meshes.push(wrap);
        out.colliders.push({
          x: sp.x, y: sp.y + targetH * 0.45, z: sp.z,
          hx: Math.max(0.6, sz.z * scale * 0.42),
          hy: targetH * 0.45,
          hz: Math.max(0.8, sz.x * scale * 0.42),
        });
        out.lights.push({
          pos: [sp.x + (sp.x < 0 ? 0.6 : -0.6), sp.y + 1.85, sp.z],
          color: [1.0, 0.72, 0.36],
          intensity: 5.5,
          distance: 7.5,
        });
      }
      console.log(`[buildings] spawned ${stallSpots.length} PBR Jiangnan night-market stalls`);
    }
  } catch (e) {
    console.warn('[buildings] stall load skipped', e);
  }

  console.log(`[buildings] props: ${acM.length} AC units, ${tankM.length + ptankM.length} tanks`);
  return meshes;
}

// box dims oriented to a facade frame: w along facade, h up, d along normal -> world sx, sy, sz
function dims(fr, w, h, d) {
  return Math.abs(fr.right[0]) > 0.5 ? [w, h, d] : [d, h, w];
}

function sideFrameOf(v, side) {
  switch (side) {
    case 'nx': return { origin: [v.x0, 0, v.z0], right: [0, 0, 1], normal: [-1, 0, 0], width: v.z1 - v.z0 };
    case 'px': return { origin: [v.x1, 0, v.z1], right: [0, 0, -1], normal: [1, 0, 0], width: v.z1 - v.z0 };
    case 'nz': return { origin: [v.x1, 0, v.z0], right: [-1, 0, 0], normal: [0, 0, -1], width: v.x1 - v.x0 };
    default: return { origin: [v.x0, 0, v.z1], right: [1, 0, 0], normal: [0, 0, 1], width: v.x1 - v.x0 };
  }
}

function f0shop(lot, front) { return !!front.shopType; }
function poster(det, fr, s, y, r, wallPt, w = 0.6, extra = 0) {
  const cell = r.int(0, 15);
  const sub = [(cell % 4) * 0.25, Math.floor(cell / 4) * 0.25, 0.25, 0.25];
  const h = w * 1.35;
  const off = 0.035 + extra + r() * 0.01;
  const p0 = wallPt(fr, s, y, off), p1 = wallPt(fr, s + w, y, off), p2 = wallPt(fr, s + w, y + h, off), p3 = wallPt(fr, s, y + h, off);
  const u = (a, b) => slotUV('posters', a, b, sub);
  det.quad(p0, p1, p2, p3, u(0, 0), u(1, 0), u(1, 1), u(0, 1), { aCol: [0.8, 0.8, 0.8, 0.0], aPbr: [0.45, 0, 1, 0.3] });
}

let _bag = null;
function bagGeo() {
  if (!_bag) { _bag = new THREE.IcosahedronGeometry(0.28, 1); _bag.scale(1, 0.85, 1); }
  return _bag;
}
let _wheel = null;
function bike(det, m, col) {
  if (!_wheel) _wheel = new THREE.TorusGeometry(0.32, 0.025, 4, 14);
  const frame = D(col, 0, 0.35, 0.6, 0.3), black = D([0.03, 0.03, 0.03], 0, 0.5, 0, 0.1);
  const tp = (x, y) => new THREE.Vector3(x, y, 0).applyMatrix4(m).toArray();
  for (const x of [-0.52, 0.52]) {
    const wm = new THREE.Matrix4().makeTranslation(x, 0.34, 0).premultiply(m);
    det.geometry(_wheel, wm, black);
  }
  det.beam(tp(-0.52, 0.34), tp(-0.05, 0.36), 0.03, frame);
  det.beam(tp(-0.05, 0.36), tp(0.38, 0.78), 0.03, frame);
  det.beam(tp(-0.05, 0.36), tp(-0.15, 0.82), 0.03, frame);
  det.beam(tp(-0.15, 0.78), tp(0.36, 0.78), 0.03, frame);
  det.beam(tp(0.52, 0.34), tp(0.4, 0.95), 0.03, frame);
  det.beam(tp(-0.52, 0.34), tp(-0.15, 0.78), 0.025, frame);
  det.beam(tp(0.3, 0.98), tp(0.5, 0.98), 0.03, black);
  det.box(...tp(-0.17, 0.88), 0.22, 0.05, 0.1, black);
  // front basket (mamachari)
  det.box(...tp(0.6, 0.85), 0.3, 0.22, 0.32, D([0.5, 0.5, 0.5], 0, 0.4, 0.7, 0.3));
}

let _dish = null;
function dishGeo() {
  if (!_dish) {
    _dish = new THREE.SphereGeometry(0.45, 10, 4, 0, Math.PI * 2, 0, 0.7);
    _dish.scale(1, 0.5, 1);
  }
  return _dish;
}
