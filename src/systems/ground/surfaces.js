// Sidewalk (shuffled photoreal concrete pavers + yellow tactile strips), granite curb, promenade stone pavers,
// alley paving. All world-space mapped, all wet via materials/wet.js.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, texture, positionWorld, abs, max, min, mix, smoothstep, step, select, floor, fract, clamp, dFdx, dFdy,
  uv, normalWorldGeometry, cameraViewMatrix, vec4, normalize, mod, exp,
} from 'three/tsl';
import { hexTaps, hexSample, hash21, hash23, fbm, vnoise, aaBand, aaStep, pairSampleGrad, slopeFromHeight, luma } from '../../materials/noise.js';
import { wetLayer, rainRipples, upNormalToView } from '../../materials/wet.js';
import { G } from './plan.js';

const B = (c) => select(c, float(1), float(0));

// ---------------------------------------------------------------------------------------------------------
export function sidewalkMaterial(T) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.sidewalk' });
  const P = positionWorld.xz;
  const x = P.x, z = P.y, ax = abs(x);
  const zs = G.crossZ;
  const zc = select(z.greaterThan((zs[0] + zs[1]) / 2), float(zs[0]), select(z.greaterThan((zs[1] + zs[2]) / 2), float(zs[1]), float(zs[2])));
  const dz = z.sub(zc), adz = abs(dz);
  const onAv = B(ax.lessThan(G.avHalf + G.avSide + 0.3));

  // --- shuffled pavers: each world tile picks one of the 64 photoreal tiles of the 8x8 running-bond texture
  const tile = 0.3;
  const w = P.div(tile);
  const jw = floor(w.y);
  const off = mod(jw, 2).mul(0.5);
  const iw = floor(w.x.sub(off));
  const local = vec2(fract(w.x.sub(off)), fract(w.y));
  const th = hash23(vec2(iw, jw).add(0.37));
  const ri = floor(th.x.mul(8)), rj = floor(th.y.mul(8));
  const offT = select(mod(rj, 2).greaterThan(0.5), float(0), float(0.5));
  const tuv = vec2(ri.add(offT).add(local.x).div(8), rj.add(local.y).div(8));
  const gdx = dFdx(w).div(8), gdy = dFdy(w).div(8);
  const S = pairSampleGrad(T.sidewalk.c, T.sidewalk.n, tuv, gdx, gdy);
  const th2 = hash23(vec2(iw, jw).add(11.3));
  let albedo = S.color.mul(mix(0.62, 0.78, th2.x)).mul(mix(0.88, 1.06, fbm(P.mul(0.18), 2)));
  // grime gradient toward building frontage + general dirt
  const front = smoothstep(G.avHalf + 2.5, G.avHalf + G.avSide, ax).mul(onAv);
  albedo = albedo.mul(mix(1.0, 0.72, front)).mul(mix(1.0, 0.75, smoothstep(0.55, 0.8, fbm(P.mul(0.6).add(4.0), 3))));
  const jointT = smoothstep(0.32, 0.12, S.h); // joints from the texture height
  albedo = albedo.mul(mix(float(1), float(0.4), jointT));
  let nxy = S.nxy.mul(0.9).add(th2.yz.sub(0.5).mul(0.035)); // per-tile tilt -> varied reflections
  let rough = mix(float(0.78), float(0.9), jointT);
  let porosity = mix(float(0.65), float(0.9), jointT);

  // --- tactile paving (yellow guide line + warning dots at crossings)
  const lineAv = B(ax.greaterThan(7.8).and(ax.lessThan(8.1))).mul(onAv).mul(B(adz.greaterThan(G.crHalf + 0.3)));
  const lineCr = B(adz.greaterThan(6.6).and(adz.lessThan(6.9)).and(ax.greaterThan(G.avHalf + G.avSide)));
  const dotsAv = B(ax.greaterThan(6.2).and(ax.lessThan(6.8)).and(adz.greaterThan(6.2)).and(adz.lessThan(9.8)));
  const dotsCr = B(ax.greaterThan(7.2).and(ax.lessThan(10.8)).and(adz.greaterThan(5.2)).and(adz.lessThan(5.8)));
  const dots = max(dotsAv, dotsCr);
  const tact = max(max(lineAv, lineCr), dots).toVar();
  // tactile local coords (bars run along the walking direction)
  const tlAv = vec2(ax.sub(7.8).div(0.3), fract(z.div(0.3)));
  const tlCr = vec2(adz.sub(6.6).div(0.3), fract(x.div(0.3)));
  const tlD = vec2(fract(x.div(0.3)), fract(z.div(0.3)));
  const tl = select(dots.greaterThan(0.5), tlD, select(lineAv.greaterThan(0.5), tlAv, tlCr));
  const tid = floor(select(lineAv.greaterThan(0.5), vec2(7, z.div(0.3)), select(lineCr.greaterThan(0.5), vec2(x.div(0.3), 3), P.div(0.3))));
  const tq = floor(hash23(tid).xy.mul(2));
  const tuvT = tq.add(vec2(0.03).add(clamp(tl, 0, 1).mul(0.94))).mul(0.5);
  const tdx = dFdx(P).div(0.6), tdy = dFdy(P).div(0.6);
  const TL = pairSampleGrad(T.tactLine.c, T.tactLine.n, tuvT, tdx, tdy);
  const TD = pairSampleGrad(T.tactDots.c, T.tactDots.n, tuvT, tdx, tdy);
  const tCol = mix(TL.color, TD.color, dots).mul(mix(0.55, 0.75, hash21(tid)));
  const tN = mix(TL.nxy, TD.nxy, dots);
  const tJoint = max(aaBand(tl.x.sub(0.5), 0.47).oneMinus(), aaBand(tl.y.sub(0.5), 0.47).oneMinus());
  albedo = mix(albedo, mix(tCol, vec3(0.03, 0.025, 0.02), tJoint), tact);
  nxy = mix(nxy, tN.mul(2.2), tact);
  rough = mix(rough, float(0.62), tact);
  porosity = mix(porosity, float(0.3), tact);

  // --- puddles: sunken tiles + low areas, joints hold water
  const pn = fbm(P.mul(0.33).add(1.7), 3);
  const sunk = th2.z.mul(0.25);
  const level = pn.add(sunk).add(jointT.mul(0.08)).sub(tact.mul(0.1));
  const puddle = smoothstep(0.74, 0.79, level).add(jointT.mul(0.35)).min(1);
  const rip = rainRipples(P);
  const L = wetLayer({ albedo, roughness: rough, nxy, porosity, puddle, ripple: rip, filmRipple: 0.12, film: [0.3, 0.05] });
  m.colorNode = L.albedo;
  m.roughnessNode = clamp(L.roughness, 0.015, 1);
  m.metalnessNode = float(0);
  m.normalNode = upNormalToView(L.nxy);
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Curb: geometry uv.x = distance along the curb (m), uv.y = profile distance (m) from the road bottom.
export function curbMaterial(T) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.curb' });
  const U = uv();
  const along = U.x, prof = U.y;
  const blockLen = 1.0;
  const bi = floor(along.div(blockLen));
  const bh = hash23(vec2(bi, 3.3));
  const t = vec2(along.add(bh.x.mul(37)), prof.add(bh.y.mul(11))).div(0.8);
  const c = texture(T.granite.c, t).rgb;
  const n = texture(T.granite.n, t);
  const joint = aaBand(fract(along.div(blockLen)).sub(0.5).abs().sub(0.5), 0.004);
  const chip = smoothstep(0.7, 0.85, vnoise(vec2(along.mul(9), prof.mul(30))));
  let albedo = c.mul(mix(0.5, 0.7, bh.z)).mul(mix(1.0, 0.25, joint)).mul(mix(1.0, 0.7, chip));
  // tyre rubber / road grime at the bottom of the face
  albedo = albedo.mul(mix(0.4, 1.0, smoothstep(0.0, 0.12, prof)));
  const up = smoothstep(0.6, 0.9, normalWorldGeometry.y);
  const P = positionWorld.xz;
  const L = wetLayer({ albedo, roughness: float(0.55).add(n.b.mul(0.2)), nxy: n.rg.mul(2).sub(1).mul(0.5), porosity: 0.35, puddle: float(0), ripple: rainRipples(P).mul(up), filmRipple: 0.2 });
  m.colorNode = L.albedo;
  m.roughnessNode = clamp(L.roughness, 0.03, 1);
  m.metalnessNode = float(0);
  // perturb the geometric normal (curb faces are not horizontal): perturbation in world, projected
  const pert = vec3(L.nxy.x, 0, L.nxy.y).mul(up).add(vec3(0, 1, 0).mul(0));
  m.normalNode = normalize(cameraViewMatrix.mul(vec4(normalWorldGeometry.add(pert), 0)).xyz);
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Promenade: running-bond granite pavers (0.8 x 0.4 m), per-stone tint/tilt/sink, flamed granite detail,
// darker coping band at the river edge. Cherry petals are decals.
export function promenadeMaterial(T) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.promenade' });
  const P = positionWorld.xz;
  const x = P.x, z = P.y;
  const w = vec2(z.div(0.8), x.div(0.4));
  const jw = floor(w.y);
  const off = mod(jw, 2).mul(0.5).add(hash21(vec2(jw, 1.0)).mul(0.0));
  const iw = floor(w.x.sub(off));
  const local = vec2(fract(w.x.sub(off)), fract(w.y));
  const id = vec2(iw, jw);
  const h = hash23(id.add(0.5));
  const h2 = hash23(id.add(17.1));
  // stone texture: random region of the paver photo (gives each stone its own grain) + granite detail
  const suv = P.div(1.6).add(h.xy.mul(13.0));
  const dx = dFdx(P).div(1.6), dy = dFdy(P).div(1.6);
  const S = pairSampleGrad(T.stone.c, T.stone.n, suv, dx, dy);
  const Gr = pairSampleGrad(T.granite.c, T.granite.n, P.div(0.7).add(h2.xy.mul(5.0)), dFdx(P).div(0.7), dFdy(P).div(0.7));
  const palette = select(h.z.lessThan(0.3), vec3(0.75, 0.75, 0.76), select(h.z.lessThan(0.55), vec3(0.5, 0.5, 0.52), select(h.z.lessThan(0.8), vec3(0.82, 0.7, 0.68), vec3(0.62, 0.6, 0.58))));
  let albedo = mix(S.color, Gr.color, 0.55).mul(palette).mul(mix(0.55, 0.75, h2.z));
  // joints
  const ex = min(local.x, local.x.oneMinus()).mul(0.8);
  const ey = min(local.y, local.y.oneMinus()).mul(0.4);
  const e = min(ex, ey);
  const joint = smoothstep(0.009, 0.004, e);
  const bevel = smoothstep(0.0, 0.02, e);
  albedo = mix(albedo, vec3(0.02, 0.02, 0.018), joint);
  albedo = albedo.mul(mix(1.0, 0.7, smoothstep(0.6, 0.85, fbm(P.mul(0.4).add(2.0), 3))));
  // coping at the river edge
  const coping = smoothstep(G.prom.x1 - 0.6, G.prom.x1 - 0.58, x);
  albedo = mix(albedo, Gr.color.mul(0.42), coping);
  const height = bevel.mul(0.004).add(h.x.mul(0.003)).add(S.h.mul(0.0015));
  const sl = slopeFromHeight(height, P);
  let nxy = sl.negate().mul(1.0).add(S.nxy.mul(0.35)).add(Gr.nxy.mul(0.25)).add(h2.xy.sub(0.5).mul(0.03));
  const rough = mix(float(0.72), float(0.9), joint);
  const sunk = h.x.mul(0.06);
  const level = fbm(P.mul(0.3).add(6.0), 3).add(sunk).add(joint.mul(0.25)).sub(coping.mul(0.3));
  const puddle = smoothstep(0.7, 0.72, level).add(joint.mul(0.5)).min(1);
  const L = wetLayer({ albedo, roughness: rough, nxy, porosity: 0.6, puddle, ripple: rainRipples(P), filmRipple: 0.12, film: [0.3, 0.05] });
  m.colorNode = L.albedo;
  m.roughnessNode = clamp(L.roughness, 0.015, 1);
  m.metalnessNode = float(0);
  m.normalNode = upNormalToView(L.nxy);
  return m;
}

// ---------------------------------------------------------------------------------------------------------
// Alley: worn stone slabs + concrete, grime and drip lines along the walls, central drain channel.
export function alleyMaterial(T) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.alley' });
  const P = positionWorld.xz;
  const x = P.x, z = P.y;
  const dz = z.sub(G.alley.z);
  const adz = abs(dz);
  const a = texture(T.alley.c, P.div(2.6)).rgb;
  const an = texture(T.alley.n, P.div(2.6));
  const ct = hexSample(hexTaps(P.div(1.8), { scale: 0.4 }), T.concrete.c, T.concrete.n);
  const mixc = smoothstep(0.45, 0.6, fbm(P.mul(0.12).add(3.0), 3));
  let albedo = mix(a, ct.color.mul(0.55), mixc.mul(0.6)).mul(0.62);
  let nxy = mix(an.rg.mul(2).sub(1), ct.nxy, mixc.mul(0.6));
  const hh = mix(an.b, ct.h, mixc.mul(0.6));
  // wall grime + drip line (water falling from eaves) along both walls
  const wall = smoothstep(G.alley.half - 0.7, G.alley.half, adz);
  const drip = aaBand(adz.sub(G.alley.half - 0.35), 0.12).mul(smoothstep(0.3, 0.6, vnoise(vec2(x.mul(1.3), 0.5))));
  albedo = albedo.mul(mix(1.0, 0.45, wall)).mul(mix(0.75, 1.1, fbm(P.mul(0.5), 3)));
  // central drain channel with steel lids
  const ch = aaBand(dz, 0.15);
  const lid = floor(x.div(0.5));
  const lidJ = aaBand(fract(x.div(0.5)).sub(0.5).abs().sub(0.5), 0.01);
  const slots = aaBand(fract(dz.div(0.05).add(0.5)).sub(0.5), 0.18).mul(B(abs(fract(x.div(0.5)).sub(0.5)).lessThan(0.38)));
  const chCol = mix(vec3(0.05, 0.048, 0.045).mul(mix(0.8, 1.3, hash21(vec2(lid, 2.0)))), vec3(0.003), max(lidJ, slots.mul(B(adz.lessThan(0.1)))));
  albedo = mix(albedo, chCol, ch);
  let rough = mix(float(0.8), float(0.5), hh.oneMinus().mul(0.3));
  rough = mix(rough, float(0.4), ch);
  const metal = ch.mul(0.6);
  const level = fbm(P.mul(0.4).add(9.0), 3).add(hh.oneMinus().mul(0.1)).add(drip.mul(0.25)).add(smoothstep(0.6, 0.0, adz).mul(0.06));
  const puddle = smoothstep(0.66, 0.71, level);
  const L = wetLayer({ albedo, roughness: rough, nxy: nxy.mul(0.9), porosity: 0.75, puddle, ripple: rainRipples(P), filmRipple: 0.2 });
  m.colorNode = L.albedo;
  m.roughnessNode = clamp(L.roughness, 0.015, 1);
  m.metalnessNode = metal;
  m.normalNode = upNormalToView(L.nxy);
  return m;
}

// River embankment wall (west bank face below the promenade): dark wet stone blocks.
export function wallMaterial(T) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.embankment' });
  const P = positionWorld;
  const u = P.z, v = P.y;
  const w = vec2(u.div(1.2), v.div(0.5));
  const jw = floor(w.y);
  const iw = floor(w.x.sub(mod(jw, 2).mul(0.5)));
  const h = hash21(vec2(iw, jw));
  const c = texture(T.granite.c, vec2(u, v).div(1.1).add(h)).rgb;
  const lx = fract(w.x.sub(mod(jw, 2).mul(0.5))), ly = fract(w.y);
  const joint = max(smoothstep(0.02, 0.0, min(lx, lx.oneMinus())), smoothstep(0.04, 0.0, min(ly, ly.oneMinus())));
  const algae = smoothstep(-1.2, -2.8, v).mul(0.7);
  const albedo = c.mul(mix(0.28, 0.42, h)).mul(mix(1.0, 0.2, joint)).mul(mix(vec3(1), vec3(0.45, 0.55, 0.4), algae));
  m.colorNode = albedo;
  m.roughnessNode = mix(float(0.18), float(0.5), joint);
  m.metalnessNode = float(0);
  return m;
}
