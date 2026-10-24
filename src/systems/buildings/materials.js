// TSL materials for the buildings workstream.
// facade: ONE material for all architectural surfaces (walls with procedural windows + interior mapping, roofs, trim).
// detail: ONE material for props/shop interiors (vertex tint + optional shop-atlas texture + emissive).
// glass : transparent shop glass.
import * as THREE from 'three/webgpu';
import {
  attribute, uv, vec2, vec3, vec4, float, floor, fract, mix, step, smoothstep, clamp, abs, min, max, sin, cos, dot,
  texture, positionWorld, cameraPosition, normalize, time, fwidth, length, normalMap, normalView, uniform, mod, pow, exp,
} from 'three/tsl';

// ---------- small hash / noise helpers (pure node graph) ----------
export const h21 = (p) => {
  const q = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const d = dot(q, vec3(q.y, q.z, q.x).add(33.33));
  const r = q.add(d);
  return fract(r.x.add(r.y).mul(r.z));
};
export const vnoise = (p) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(-2).add(3));
  const a = h21(i), b = h21(i.add(vec2(1, 0))), c = h21(i.add(vec2(0, 1))), d = h21(i.add(vec2(1, 1)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
};
const fbm3 = (p) => vnoise(p).mul(0.55).add(vnoise(p.mul(2.13).add(5.2)).mul(0.3)).add(vnoise(p.mul(4.7).add(1.7)).mul(0.15));

// Tileable noise texture (RGBA): R = fbm (4 cells), G = fbm (16 cells), B = value noise (64 cells),
// A = vertical streaks (64 cells in x, 4 in y). One fetch replaces dozens of ALU hashes per pixel.
export function createNoiseTexture(size = 512) {
  const data = new Uint8Array(size * size * 4);
  const hashI = (x, y, s) => {
    let h = Math.imul(x * 374761393 + y * 668265263 + s * 2147483647, 1274126177) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vn = (u, v, cx, cy, s) => {
    const x = u * cx, y = v * cy;
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const h = (a, b) => hashI(((a % cx) + cx) % cx, ((b % cy) + cy) % cy, s);
    const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
  const fbm = (u, v, c, s) => (vn(u, v, c, c, s) * 0.5 + vn(u, v, c * 2, c * 2, s + 1) * 0.28 + vn(u, v, c * 4, c * 4, s + 2) * 0.14 + vn(u, v, c * 8, c * 8, s + 3) * 0.08) / 1.0;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const u = i / size, v = j / size, k = (j * size + i) * 4;
    data[k] = Math.min(255, fbm(u, v, 4, 11) * 255);
    data[k + 1] = Math.min(255, fbm(u, v, 16, 21) * 255);
    data[k + 2] = vn(u, v, 64, 64, 31) * 255;
    data[k + 3] = (vn(u, v, 64, 4, 41) * 0.7 + vn(u, v, 128, 8, 51) * 0.3) * 255;
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

const aaRect = (p, x0, x1, y0, y1) => {
  const w = fwidth(p).max(vec2(1e-5));
  const mx = smoothstep(w.x.negate(), w.x, p.x.sub(x0)).mul(smoothstep(w.x.negate(), w.x, x1.sub(p.x)));
  const my = smoothstep(w.y.negate(), w.y, p.y.sub(y0)).mul(smoothstep(w.y.negate(), w.y, y1.sub(p.y)));
  return mx.mul(my);
};

// --------------------------------------------------------------------------------------------------
export function createFacadeMaterial({ albedo, normal, interior, wetness, noise }) {
  const nz = (p) => texture(noise, p);
  const m = new THREE.MeshStandardNodeMaterial();
  const A = attribute('aWin', 'vec4');
  const B = attribute('aWin2', 'vec4');
  const C = attribute('aWin3', 'vec4');
  const seed = A.x, floorH = A.y, bayW = A.z, startY = A.w;
  const ww = B.x, wh = B.y, litP = B.z, kind = floor(B.w.add(0.5));
  const topY = C.x, layer = floor(C.y.add(0.5)), texScale = C.z, tint = C.w;
  const wet = wetness ?? float(1);
  const fuv = uv();
  const P = positionWorld;
  const sd = floor(seed.mul(9973.0).add(0.5)); // quantized: interpolated attributes jitter by ULPs

  const k0 = step(kind, 0.5);
  const k1 = step(0.5, kind).mul(step(kind, 1.5));
  const k2 = step(1.5, kind).mul(step(kind, 2.5));
  const k3 = step(2.5, kind).mul(step(kind, 3.5));
  const kRoof = step(3.5, kind).mul(step(kind, 4.5));
  const kPunch = k0.add(k3);

  // ---------- wall texture (atlas 4x2, grad-sampled, two-scale anti-repeat blend) ----------
  const col = mod(layer, 4.0), row = floor(layer.div(4.0));
  const atlasSample = (tex, t) => {
    const c = fract(t);
    const au = col.add(c.x.mul(0.99).add(0.005)).div(4.0);
    const av = float(1).sub(row.add(1).div(2.0)).add(c.y.mul(0.99).add(0.005).div(2.0));
    return texture(tex, vec2(au, av)).grad(t.dFdx().mul(vec2(0.25 * 0.99, 0.5 * 0.99)), t.dFdy().mul(vec2(0.25 * 0.99, 0.5 * 0.99)));
  };
  const tuv = fuv.div(texScale).add(vec2(sd.mul(0.137), sd.mul(0.071)));
  const tuv2 = tuv.mul(0.57).add(vec2(0.31, 0.77));
  const macro = nz(vec2(P.x.add(P.z), P.y).mul(0.015).add(sd.mul(0.0137))).r;
  const blendM = smoothstep(0.38, 0.62, macro);
  const a1 = atlasSample(albedo, tuv).rgb, a2 = atlasSample(albedo, tuv2).rgb;
  let wallAlb = mix(a1, a2, blendM);
  const n1 = atlasSample(normal, tuv).rgb, n2 = atlasSample(normal, tuv2).rgb;
  const wallNrm = mix(n1, n2, blendM);

  // building tint + macro dirt
  const pal = vec3(0.5).add(cos(vec3(0.0, 2.1, 4.2).add(tint.mul(6.283))).mul(0.5));
  const tintCol = mix(vec3(1.0), pal, 0.22).mul(mix(0.72, 1.12, h21(vec2(sd, 3.1))));
  const dirt = nz(vec2(P.x.add(P.z.mul(0.7)), P.y.mul(1.6)).mul(0.016)).g;
  wallAlb = wallAlb.mul(tintCol).mul(mix(0.7, 1.05, dirt));

  // ---------- window grid ----------
  const cx = fuv.x.div(bayW);
  const ix = floor(cx), fx = fract(cx);
  const ry = fuv.y.sub(startY);
  const cy = ry.div(floorH);
  const iy = floor(cy), fy = fract(cy);
  const cellId = vec2(ix.add(sd.mul(0.731)), iy.add(sd.mul(0.377)));
  const hA = h21(cellId), hB = h21(cellId.add(17.1)), hC = h21(cellId.add(41.7)), hD = h21(cellId.add(73.3));
  const zone = step(0.0, ry).mul(step(fuv.y, topY.sub(0.5))).mul(step(kind, 3.5));
  const present = mix(float(1), step(hD, 0.42), k3).mul(zone);

  // window rect in cell coords
  const wwE = mix(ww, ww.mul(0.45), k3);
  const x0 = mix(float(0.5).sub(wwE.mul(0.5)), float(0.025), k1.add(k2));
  const x1 = mix(float(0.5).add(wwE.mul(0.5)), float(0.975), k1.add(k2));
  const y0 = mix(mix(float(0.27), float(0.42), k3), float(0.12), k2);
  const y1 = min(mix(y0.add(mix(wh, wh.mul(0.5), k3)), float(0.97), k2), 0.94);

  // tangent-space view vector (meshes are merged in world space => attributes are world-space)
  const T = attribute('tangent', 'vec4').xyz;
  const N = attribute('normal', 'vec3');
  const V = P.sub(cameraPosition);
  const vz = max(dot(V, N).negate(), 0.001);
  const vt = vec3(dot(V, T), V.y, vz);

  const recess = mix(float(0.16), float(0.03), k2);
  const fc = vec2(fx, fy);
  const g = fc.add(vec2(vt.x.div(vt.z).mul(recess).div(bayW), vt.y.div(vt.z).mul(recess).div(floorH)));
  const opening = aaRect(fc, x0, x1, y0, y1).mul(present);
  const glassIn = aaRect(g, x0, x1, y0, y1);
  const reveal = opening.mul(float(1).sub(glassIn));
  const glassV = opening.mul(glassIn);

  // frame / mullions at glass plane (meters)
  const ex = min(g.x.sub(x0), x1.sub(g.x)).mul(bayW);
  const ey = min(g.y.sub(y0), y1.sub(g.y)).mul(floorH);
  const fw = mix(float(0.05), float(0.035), k2);
  const winWm = x1.sub(x0).mul(bayW);
  const midX = x0.add(x1).mul(0.5);
  const mullion = abs(g.x.sub(midX)).mul(bayW).lessThan(0.025).select(1.0, 0.0).mul(step(1.0, winWm)).mul(float(1).sub(k2));
  const transomY = y0.add(y1.sub(y0).mul(0.72));
  const transom = abs(g.y.sub(transomY)).mul(floorH).lessThan(0.022).select(1.0, 0.0).mul(step(0.6, hB)).mul(k0.add(k2));
  const frame = max(max(float(1).sub(smoothstep(fw.mul(0.8), fw, min(ex, ey))), mullion), transom).mul(glassV);
  const glass = glassV.mul(float(1).sub(frame));

  // ---------- interior mapping (room = bay x floor x depth) ----------
  const depth = mix(float(1.8), float(3.4), hC);
  const d = vec3(vt.x.div(bayW), vt.y.div(floorH), vt.z.div(depth));
  const sx = d.x.greaterThan(0).select(1.0, 0.0), sy = d.y.greaterThan(0).select(1.0, 0.0);
  const dxs = abs(d.x).max(1e-4).mul(sx.mul(2).sub(1));
  const dys = abs(d.y).max(1e-4).mul(sy.mul(2).sub(1));
  const o = vec2(clamp(g.x, 0.001, 0.999), clamp(g.y, 0.001, 0.999));
  const tX = sx.sub(o.x).div(dxs), tY = sy.sub(o.y).div(dys), tZ = float(1).div(d.z);
  const tMin = min(min(tX, tY), tZ);
  const hit = vec3(o.x.add(d.x.mul(tMin)), o.y.add(d.y.mul(tMin)), d.z.mul(tMin));
  const isBack = step(tZ, min(tX, tY));
  const isSide = float(1).sub(isBack).mul(step(tX, tY));
  const isFC = float(1).sub(isBack).sub(isSide).max(0);
  const isFloor = isFC.mul(float(1).sub(sy));
  const isCeil = isFC.mul(sy);
  const idx = floor(hA.mul(15.999));
  const aiu = mod(idx, 4.0).add(hit.x.mul(0.96).add(0.02)).div(4.0);
  const aiv = float(1).sub(floor(idx.div(4.0)).add(1).div(4.0)).add(hit.y.mul(0.96).add(0.02).div(4.0));
  const gscale = vec2(0.25, 0.25);
  const backTex = texture(interior, vec2(aiu, aiv)).grad(vec2(cx.dFdx(), cy.dFdx()).mul(gscale), vec2(cx.dFdy(), cy.dFdy()).mul(gscale)).rgb;
  const roomWall = mix(mix(vec3(0.62, 0.56, 0.47), vec3(0.55, 0.57, 0.58), step(0.5, hB)), vec3(0.42, 0.47, 0.52), step(0.8, hC));
  const floorCol = mix(vec3(0.28, 0.19, 0.12), vec3(0.36, 0.38, 0.26), step(0.7, hD));
  const lampD = length(vec2(hit.x.sub(0.5), hit.z.sub(0.4)));
  const lamp = smoothstep(0.2, 0.07, lampD).mul(isCeil);
  const fall = clamp(float(1.3).sub(length(vec3(hit.x.sub(0.5), hit.y.sub(0.95), hit.z.sub(0.4))).mul(0.75)), 0.25, 1.2);
  const panel = mix(0.75, 1.0, step(0.05, fract(hit.x.mul(2.0))).mul(step(0.05, fract(hit.z.mul(2.5)))));
  const interiorCol = backTex.mul(isBack).mul(0.95)
    .add(roomWall.mul(isSide).mul(0.8))
    .add(floorCol.mul(isFloor).mul(0.8))
    .add(roomWall.mul(isCeil).mul(0.42).mul(panel).mul(float(1).sub(smoothstep(0.03, 0.0, abs(lampD.sub(0.24))).mul(0.8))))
    .mul(fall).add(vec3(lamp.mul(3.5)));

  // lights
  const lit = step(hB, litP).mul(present);
  const ht = h21(cellId.add(91.3));
  const flick = sin(time.mul(7.3).add(hA.mul(60))).mul(sin(time.mul(2.1).add(hC.mul(13)))).mul(0.35).add(0.6);
  const warm = vec3(1.0, 0.68, 0.38), cool = vec3(0.72, 0.86, 1.0), tv = vec3(0.35, 0.5, 1.0).mul(flick);
  const lightCol = mix(mix(warm, cool, step(0.55, ht)), tv, step(0.87, ht).mul(float(1).sub(k2)));
  const intensity = mix(0.35, 1.1, hC.mul(hC)).mul(mix(1.0, 1.3, k2));

  // curtains / blinds / frosted
  const pxw = g.x.sub(x0).div(x1.sub(x0).max(1e-3));
  const pyw = g.y.sub(y0).div(y1.sub(y0).max(1e-3));
  const hc = h21(cellId.add(57.9));
  const c0 = mix(0.08, 0.45, hD), c1 = c0.add(mix(0.12, 0.5, hA));
  const tCurt = step(0.45, hc).mul(step(hc, 0.7));
  const tBlind = step(0.7, hc).mul(step(hc, 0.83));
  const tFrost = step(0.83, hc).mul(step(hc, 0.93));
  const tLace = step(0.93, hc);
  const curtCover = float(1).sub(step(c0, pxw).mul(step(pxw, c1)));
  const slatF = pyw.mul(14.0);
  const slat = mix(step(0.3, fract(slatF)), float(0.7), smoothstep(0.25, 0.7, fwidth(slatF)));
  const coverRaw = tCurt.mul(curtCover).add(tBlind.mul(slat).mul(0.92)).add(tFrost).add(tLace.mul(0.7));
  const cover = coverRaw.mul(float(1).sub(k2.mul(0.6)));
  const curtPal = mix(mix(vec3(0.75, 0.68, 0.55), vec3(0.6, 0.65, 0.75), step(0.5, hA)), vec3(0.7, 0.45, 0.42), step(0.85, hB));
  const curtCol = mix(curtPal.mul(sin(pxw.mul(38.0)).mul(mix(0.14, 0.0, smoothstep(0.3, 1.0, fwidth(pxw.mul(6.0))))).add(0.88)), vec3(0.8, 0.82, 0.8), tBlind.add(tFrost).add(tLace).min(1));
  const seen = mix(interiorCol, curtCol.mul(0.8), cover);

  const dim = step(litP, hB).mul(step(hB, litP.add(0.35))).mul(present);
  const glassEm = seen.mul(lightCol).mul(intensity.mul(lit).add(dim.mul(0.07)));
  const glassAlb = seen.mul(0.05).add(vec3(0.008, 0.01, 0.013));

  // frame colour per building
  const fsel = h21(vec2(sd, 8.8));
  const frameCol = mix(mix(vec3(0.5, 0.52, 0.53), vec3(0.05, 0.05, 0.055), step(0.45, fsel)), vec3(0.24, 0.19, 0.14), step(0.85, fsel));

  // ---------- wall extras: sills, slab bands, streaks, wet tops ----------
  const sillMask = aaRect(fc, x0.sub(float(0.05).div(bayW)), x1.add(float(0.05).div(bayW)), y0.sub(float(0.07).div(floorH)), y0).mul(present).mul(kPunch);
  const belowSill = y0.sub(fy).mul(floorH); // meters below sill in this cell
  const underWin = step(x0.add(0.02), fx).mul(step(fx, x1.sub(0.02))).mul(step(0.0, belowSill)).mul(present).mul(kPunch);
  const stN = nz(vec2(fuv.x.mul(0.11), fuv.y.mul(0.0055))).b;
  const winStreak = underWin.mul(smoothstep(1.4, 0.0, belowSill)).mul(smoothstep(0.35, 0.7, stN));
  const rainN = nz(vec2(fuv.x.mul(0.045).add(sd.mul(0.01)), fuv.y.mul(0.012))).a.mul(nz(vec2(fuv.x.mul(0.01), fuv.y.mul(0.004).add(sd.mul(0.01)))).r).mul(1.6);
  const rainStreak = smoothstep(0.18, 0.5, rainN);
  const topWet = smoothstep(topY.sub(4.0), topY.add(0.5), fuv.y);
  const slab = step(fy, float(0.09).div(floorH).mul(1.0)).mul(zone).mul(k0.add(k1));
  const groundGrime = smoothstep(1.6, 0.0, P.y.sub(0.0)).mul(0.5);
  const streakAll = clamp(winStreak.add(rainStreak.mul(0.7)).add(topWet.mul(0.5)), 0, 1);

  let wall = wallAlb.mul(mix(1.0, 0.82, slab)).mul(float(1).sub(groundGrime.mul(0.4)));
  wall = mix(wall, vec3(0.42, 0.41, 0.39).mul(tintCol), sillMask.mul(0.8));
  wall = wall.mul(mix(1.0, 0.68, streakAll.mul(wet)));
  const wallLum = dot(wallAlb, vec3(0.3, 0.59, 0.11));
  const wallRough = mix(float(0.9).sub(wallLum.mul(0.2)), float(0.32), clamp(wet.mul(0.35).add(streakAll.mul(wet).mul(0.55)), 0, 1));

  // ---------- roof ----------
  const puddle = smoothstep(0.56, 0.62, nz(fuv.mul(0.05).add(sd.mul(0.01))).r);
  const roofAlb = wallAlb.mul(mix(0.85, 0.45, puddle));
  const roofRough = mix(mix(float(0.85), float(0.4), wet), float(0.03), puddle.mul(wet));

  // ---------- far-distance antialias: blend window detail into a per-cell average ----------
  const cellPx = max(fwidth(cx), fwidth(cy));
  const aaF = smoothstep(0.18, 0.55, cellPx).mul(zone);
  const glassFrac = x1.sub(x0).mul(y1.sub(y0)).mul(present);
  const avgEm = lightCol.mul(intensity).mul(lit).mul(0.42).mul(float(1).sub(cover.mul(0.5))).mul(glassFrac.mul(1.4));
  const statEm = lightCol.mul(0.5).mul(litP).mul(glassFrac).mul(0.55).mul(present.max(zone.mul(0.4)));
  const farEm = mix(avgEm, statEm, smoothstep(0.7, 1.6, cellPx));

  // ---------- compose ----------
  const reveal2 = reveal.mul(float(1).sub(aaF));
  const glass2 = glass.mul(float(1).sub(aaF));
  const frame2 = frame.mul(float(1).sub(aaF));
  const wallW = float(1).sub(reveal2).sub(glass2).sub(frame2).max(0);
  let albedoC = wall.mul(wallW).add(wallAlb.mul(0.4).mul(reveal2)).add(glassAlb.mul(glass2)).add(frameCol.mul(frame2));
  albedoC = mix(albedoC, mix(albedoC, vec3(0.02), glassFrac.mul(0.6)), aaF);
  albedoC = mix(albedoC, roofAlb, kRoof);
  let roughC = wallRough.mul(wallW.add(reveal2)).add(mix(mix(float(0.06), float(0.035), k2).add(stN.mul(0.05)), float(0.45), lit.mul(mix(0.6, 1.0, cover))).mul(glass2)).add(float(0.35).mul(frame2));
  roughC = mix(roughC, mix(roughC, float(0.15), glassFrac), aaF);
  roughC = mix(roughC, roofRough, kRoof);
  const metalC = frame2.mul(step(fsel, 0.45)).mul(0.7);
  let emC = glassEm.mul(glass2).add(farEm.mul(aaF));
  emC = emC.mul(float(1).sub(kRoof));

  m.colorNode = vec4(albedoC, 1);
  m.roughnessNode = clamp(roughC, 0.02, 1.0);
  m.metalnessNode = metalC;
  m.emissiveNode = emC;
  const wallN = normalMap(wallNrm, vec2(mix(0.6, 0.25, streakAll.mul(wet))));
  const nMask = wallW.mul(float(1).sub(puddle.mul(kRoof)));
  m.normalNode = normalize(mix(normalView, wallN, nMask));
  return m;
}

// --------------------------------------------------------------------------------------------------
// Detail material: vertex tint aCol.rgb, aCol.w = emissive intensity; aPbr = (roughness, metalness, texMix, grime)
// uv = shop-atlas uv when texMix > 0.
export function createDetailMaterial({ atlas, wetness, noise }) {
  const m = new THREE.MeshStandardNodeMaterial();
  const Ca = attribute('aCol', 'vec4');
  const Pb = attribute('aPbr', 'vec4');
  const wet = wetness ?? float(1);
  const tx = texture(atlas, uv()).rgb;
  const base = mix(vec3(1), tx, Pb.z).mul(Ca.rgb);
  const P = positionWorld;
  const N0 = texture(noise, vec2(P.x.add(P.z.mul(0.83)), P.y.mul(1.7)).mul(0.11));
  const N1 = texture(noise, vec2(P.x.mul(0.7).add(P.z), P.y.mul(0.25)).mul(0.6));
  // blotchy grime + vertical rust/drip streaks (only where grime weight > 0)
  const gr = N0.g.mul(0.6).add(N1.a.mul(0.4));
  const grime = mix(float(1), mix(0.45, 1.08, gr), Pb.w);
  const rustTint = mix(vec3(1), vec3(1.05, 0.85, 0.65), smoothstep(0.55, 0.8, N1.a).mul(Pb.w).mul(Pb.y.add(0.3).min(1)));
  const up = smoothstep(0.5, 0.9, attribute('normal', 'vec3').y);
  m.colorNode = vec4(base.mul(grime).mul(rustTint).mul(mix(1.0, 0.75, wet.mul(Pb.w))), 1);
  m.roughnessNode = clamp(mix(Pb.x, Pb.x.mul(0.45), wet.mul(mix(0.5, 1.0, up))).mul(mix(0.8, 1.2, N0.b)), 0.03, 1);
  m.metalnessNode = Pb.y;
  m.emissiveNode = base.mul(Ca.w);
  return m;
}

export function createGlassMaterial() {
  const m = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false });
  const P = positionWorld;
  const smear = vnoise(vec2(P.x.add(P.z).mul(3.0), P.y.mul(0.6)));
  m.colorNode = vec4(vec3(0.03, 0.04, 0.045), 1);
  m.opacityNode = mix(float(0.12), float(0.3), smear);
  m.roughnessNode = mix(float(0.03), float(0.12), smear);
  m.metalnessNode = float(0.0);
  return m;
}

// AC condenser unit (instanced). Local coords from the GLB: front at +Z.
export function createACMaterial(wetness) {
  const m = new THREE.MeshStandardNodeMaterial();
  const P = positionWorld;
  const gr = fbm3(vec2(P.x.add(P.z), P.y).mul(4.0));
  m.colorNode = vec4(vec3(0.72, 0.71, 0.66).mul(mix(0.45, 1.0, gr)), 1);
  m.roughnessNode = mix(float(0.6), float(0.3), wetness ?? float(1));
  m.metalnessNode = float(0.15);
  return m;
}
