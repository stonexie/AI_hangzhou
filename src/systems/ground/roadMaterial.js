// Road / base-ground material: hex-tiled photoreal asphalt (2 variants), patches, tar seams, cracks, oil, wheel paths,
// Japanese road markings (analytic + glyph atlas), gutters with running water, storm drains, manholes, puddles + rain.
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, texture, positionWorld, abs, max, min, mix, smoothstep, step, select, floor, fract, length, clamp, sign,
  fwidth, exp, dot, cos, sin, mx_worley_noise_vec2,
} from 'three/tsl';
import { hexTaps, hexSample, hash21, hash23, fbm, vnoise, aaBand, aaStep, sdBox2, luma } from '../../materials/noise.js';
import { wetLayer, rainRipples, upNormalToView, wetUniforms } from '../../materials/wet.js';
import { G } from './plan.js';
import { GLYPH, N_CELLS } from './markings.js';

const sq = (v) => v.mul(v);
const B = (c) => select(c, float(1), float(0)); // bool -> float

// fract-stripe with a proper AA width (fract kills derivatives at the wrap)
const stripe = (coord, period, duty) => {
  const t = coord.div(period);
  const w = fwidth(t).max(1e-4);
  const f = abs(fract(t).sub(0.5));
  return smoothstep(w.add(duty * 0.5), w.negate().add(duty * 0.5), f);
};

export function roadMaterial(T, atlas) {
  const m = new THREE.MeshStandardNodeMaterial({ name: 'ground.road' });
  const P = positionWorld.xz.toVar('gP');
  const x = P.x, z = P.y;
  const ax = abs(x);
  const zs = G.crossZ;
  const zc = select(z.greaterThan((zs[0] + zs[1]) / 2), float(zs[0]), select(z.greaterThan((zs[1] + zs[2]) / 2), float(zs[1]), float(zs[2]))).toVar();
  const dz = z.sub(zc);
  const adz = abs(dz);

  // ---- region / curb distance ----------------------------------------------------------------------------
  const crossValid = x.greaterThan(G.xW).and(x.lessThan(G.xE));
  const avValid = z.lessThan(G.zS).and(z.greaterThan(G.zN));
  const r = G.cornerR;
  const wq = vec2(float(r).sub(ax.sub(G.avHalf)), float(r).sub(adz.sub(G.crHalf)));
  const cdRound = length(max(wq, 0)).add(min(max(wq.x, wq.y), 0)).sub(r);
  const cd = select(crossValid, select(avValid, cdRound, float(G.crHalf).sub(adz)), float(G.avHalf).sub(ax)).toVar('gCd'); // >0 in road
  const inAv = B(ax.lessThan(G.avHalf).and(z.lessThan(G.zS + 120)).and(z.greaterThan(G.zN - 200)));
  const inCr = B(adz.lessThan(G.crHalf).and(crossValid));
  const road = max(inAv, inCr).toVar();
  const curbed = B(avValid.or(crossValid.and(adz.lessThan(G.crHalf + 0.5)))).mul(B(ax.lessThan(G.avHalf + 0.5).or(crossValid))).mul(road);
  const isAvF = B(float(G.avHalf).sub(ax).greaterThanEqual(float(G.crHalf).sub(adz)).or(crossValid.not())).toVar();
  const across = mix(dz, x, isAvF);                // coordinate across the current road
  const along = mix(x, z, isAvF);                  // coordinate along the current road
  // lane-relative coordinate (avenue lanes 3m, cross lanes 5m)
  const lr = mix(adz.sub(2.5), fract(ax.div(3)).mul(3).sub(1.5), isAvF).toVar();

  // ---- asphalt base: two hex-tiled photoreal variants with macro blend --------------------------------------
  const tA = hexTaps(P.div(1.7), { scale: 0.42, sharp: 5 });
  const sA = hexSample(tA, T.asphaltA.c, T.asphaltA.n);
  const tB = hexTaps(P.div(2.4).add(vec2(13.1, 7.7)), { scale: 0.38, sharp: 5 });
  const sB = hexSample(tB, T.asphaltB.c, T.asphaltB.n);
  sB.color = sB.color.mul(0.78);
  const macro = fbm(P.mul(0.028), 3).toVar();
  const macro2 = fbm(P.mul(0.11).add(9.7), 3).toVar();
  const old = smoothstep(0.38, 0.66, macro.add(macro2.sub(0.5).mul(0.35))).toVar();
  let albedo = mix(sA.color, sB.color.mul(0.82), old);
  let nxy = mix(sA.nxy, sB.nxy, old).mul(0.85);
  const hAsph = mix(sA.h, sB.h, old).toVar();
  albedo = albedo.mul(mix(0.8, 1.12, macro2)).mul(mix(1.0, 0.86, smoothstep(0.55, 0.8, fbm(P.mul(0.45).add(3.3), 2))));
  let rough = mix(0.86, 0.66, hAsph); // aggregate tops are polished
  let porosity = float(0.85);
  let metal = float(0);

  // wheel paths (polished, rubber-darkened, slightly rutted) and oil drip strip in the lane centre
  const wheel = exp(sq(abs(lr).sub(0.85)).mul(-1 / (2 * 0.24 * 0.24))).mul(road).toVar();
  const oilN = fbm(vec2(lr.mul(2.2), along.mul(0.16)).add(5.1), 3);
  const oil = exp(sq(lr).mul(-1 / (2 * 0.3 * 0.3))).mul(smoothstep(0.5, 0.78, oilN)).mul(road).toVar();
  albedo = albedo.mul(mix(1.0, 0.8, wheel)).mul(mix(1.0, 0.55, oil));
  rough = mix(rough, rough.mul(0.8), wheel);
  rough = mix(rough, float(0.35), oil);
  porosity = mix(porosity, float(0.2), oil);

  // ---- repaired patches (per 19m cell along each road) + utility trench strips --------------------------------
  const cellL = 19.0;
  const pc = floor(along.div(cellL));
  const ph = hash23(vec2(pc, isAvF.mul(7).add(zc.mul(0.01))));
  const ph2 = hash23(vec2(pc.add(91.0), isAvF.add(3.0)));
  const pU = ph.x.sub(0.5).mul(mix(7.0, 8.0, isAvF));
  const pHalf = vec2(ph.y.mul(1.6).add(0.55), ph2.x.mul(3.4).add(0.7));
  const pV = pc.mul(cellL).add(cellL * 0.5).add(ph.z.sub(0.5).mul(cellL - 9));
  const pSd = sdBox2(vec2(across.sub(pU), along.sub(pV)), pHalf);
  const pExists = step(0.45, ph2.y).mul(road);
  // long trench strip
  const trU = mix(float(-2.2), float(3.6), step(0.5, ph2.z));
  const trSd = sdBox2(vec2(across.sub(trU), along.sub(pc.mul(cellL).add(cellL / 2))), vec2(0.32, cellL * 0.5 + 0.3));
  const trExists = step(0.72, hash21(vec2(floor(along.div(cellL * 3)), isAvF.add(11.0)))).mul(road);
  const patchSd = min(select(pExists.greaterThan(0.5), pSd, float(99)), select(trExists.greaterThan(0.5), trSd, float(99))).toVar();
  const patchIn = aaStep(patchSd.negate());
  const seamWob = vnoise(P.mul(6.0)).sub(0.5).mul(0.03);
  const patchSeam = aaBand(patchSd.add(seamWob), 0.03).toVar();
  const patchTone = mix(0.38, 0.6, hash21(vec2(pc, 2.0)));
  albedo = mix(albedo, sB.color.mul(patchTone).mul(vec3(0.95, 0.97, 1.0)), patchIn.mul(0.85));
  rough = mix(rough, float(0.8), patchIn.mul(0.5));

  // ---- tar snakes (sealed cracks, glossy black) + alligator cracking ------------------------------------------
  const warp = vec2(fbm(P.mul(0.31), 2), fbm(P.mul(0.31).add(4.4), 2)).sub(0.5).mul(2.4);
  const tn = fbm(P.mul(0.16).add(warp.mul(0.3)), 3);
  const snake = aaBand(tn.sub(0.5), 0.0065).mul(smoothstep(0.52, 0.68, fbm(P.mul(0.045).add(2.2), 2))).mul(road);
  const tar = max(snake, patchSeam).toVar();
  const wn = mx_worley_noise_vec2(P.mul(0.95).add(warp.mul(0.35)));
  const crackE = wn.y.sub(wn.x);
  const crackZone = smoothstep(0.6, 0.78, old.mul(0.6).add(fbm(P.mul(0.07).add(8.0), 2).mul(0.6))).mul(road).mul(patchIn.oneMinus());
  const crack = smoothstep(0.05, 0.0, crackE).mul(crackZone).toVar();
  albedo = mix(albedo, vec3(0.018, 0.017, 0.016), tar.mul(0.92));
  albedo = albedo.mul(mix(1.0, 0.35, crack));
  rough = mix(rough, float(0.32), tar);
  porosity = mix(porosity, float(0.05), tar);
  nxy = mix(nxy, nxy.mul(0.2), tar);

  // ---- markings ------------------------------------------------------------------------------------------------
  const wear = texture(T.paintWear.c, P.div(1.35)).r;
  // avenue frame
  const sAv = adz.sub(G.crHalf);
  const apprAv = B(x.lessThan(0).and(dz.greaterThan(0)).or(x.greaterThan(0).and(dz.lessThan(0))));
  const avLines = B(sAv.greaterThan(6.4)).mul(inAv).mul(isAvF);
  const centerY = aaBand(ax.sub(0.17), 0.065).mul(avLines);
  const solidZone = B(sAv.lessThan(32));
  const dashA = B(fract(z.div(10)).lessThan(0.5));
  const laneLn = aaBand(ax.sub(3.0), 0.075).mul(avLines);
  const laneY = laneLn.mul(solidZone);
  const laneW = laneLn.mul(solidZone.oneMinus()).mul(dashA);
  const edgeA = aaBand(ax.sub(G.avHalf - 0.55), 0.075).mul(avLines);
  const zebraA = stripe(x.add(0.225), 0.9, 0.5).mul(B(sAv.greaterThan(1.0).and(sAv.lessThan(5.0)).and(ax.lessThan(5.4)))).mul(inAv);
  const stopA = aaBand(sAv.sub(6.0), 0.225).mul(apprAv).mul(B(ax.greaterThan(0.35).and(ax.lessThan(G.avHalf - 0.45)))).mul(inAv);
  // glyph slots in approach lanes
  const outer = B(ax.greaterThan(3.0));
  const laneC = sign(x).mul(mix(1.5, 4.5, outer));
  const uRaw = select(x.lessThan(0), x.sub(laneC), laneC.sub(x));
  const sl = (a, b) => B(sAv.greaterThanEqual(a).and(sAv.lessThan(b)));
  // slot table: [start, length, width, cell]
  const slots = [
    [8.0, 5.0, 1.7, null], [25.0, 3.6, 1.5, GLYPH.DIAMOND], [44.0, 4.5, 2.1, GLYPH.SPEED], [55.0, 3.6, 1.5, GLYPH.DIAMOND], [80.0, 5.5, 2.3, GLYPH.BUS],
  ];
  let s0 = float(-100), sLen = float(1), sW = float(1), sCell = float(0), sOk = float(0);
  for (const [a, len, w, cell] of slots) {
    const inS = sl(a, a + len);
    const c = cell === null ? mix(float(GLYPH.ARROW_R), float(GLYPH.ARROW_L), outer) : float(cell);
    const ok = cell === GLYPH.BUS ? outer : float(1);
    s0 = mix(s0, float(a), inS); sLen = mix(sLen, float(len), inS); sW = mix(sW, float(w), inS); sCell = mix(sCell, c, inS); sOk = mix(sOk, ok, inS);
  }
  const gu = uRaw.div(sW).add(0.5);
  const gv = s0.add(sLen).sub(sAv).div(sLen);
  const gIn = B(gu.greaterThan(0).and(gu.lessThan(1)).and(gv.greaterThan(0)).and(gv.lessThan(1))).mul(sOk).mul(apprAv).mul(avLines);
  const glyphA = texture(atlas, vec2(sCell.add(clamp(gu, 0.01, 0.99)).div(N_CELLS), clamp(gv, 0.005, 0.995))).r.mul(gIn);

  // cross street frame
  const sCr = ax.sub(G.avHalf);
  const apprCr = B(x.lessThan(0).and(dz.lessThan(0)).or(x.greaterThan(0).and(dz.greaterThan(0))));
  const crLines = B(sCr.greaterThan(6.4)).mul(inCr).mul(isAvF.oneMinus());
  const centerC = aaBand(dz, 0.075).mul(crLines).mul(B(fract(x.div(9)).lessThan(0.55)));
  const edgeC = aaBand(adz.sub(G.crHalf - 0.45), 0.07).mul(crLines);
  const zebraC = stripe(dz.add(0.225), 0.9, 0.5).mul(B(sCr.greaterThan(1.0).and(sCr.lessThan(5.0)).and(adz.lessThan(4.4)))).mul(inCr);
  const stopC = aaBand(sCr.sub(6.0), 0.225).mul(apprCr).mul(B(adz.greaterThan(0.2).and(adz.lessThan(G.crHalf - 0.4)))).mul(inCr);
  const laneCC = sign(dz).mul(2.5);
  const uC = select(x.lessThan(0), dz.sub(laneCC), laneCC.sub(dz)).div(2.6).add(0.5);
  const vC = float(7.6 + 5.0).sub(sCr).div(5.0);
  const gInC = B(uC.greaterThan(0).and(uC.lessThan(1)).and(vC.greaterThan(0)).and(vC.lessThan(1))).mul(apprCr).mul(inCr);
  const glyphC = texture(atlas, vec2(float(GLYPH.STOP).add(clamp(uC, 0.01, 0.99)).div(N_CELLS), clamp(vC, 0.005, 0.995))).r.mul(gInC);

  const whiteRaw = max(max(max(laneW, edgeA), max(zebraA, stopA)), max(max(glyphA, glyphC), max(max(centerC, edgeC), max(zebraC, stopC))));
  const yellowRaw = max(centerY, laneY);
  // per-segment freshness: some markings were repainted recently, others are almost gone
  const fresh = hash21(vec2(floor(along.div(23)), zc.add(isAvF.mul(5))));
  const grit = fbm(P.mul(3.1).add(2.0), 3);
  const keep = smoothstep(0.4, 0.62, wear.mul(0.9).add(fresh.mul(0.38)).add(grit.sub(0.5).mul(0.5)).sub(wheel.mul(0.3)).sub(crack));
  const white = whiteRaw.mul(keep).mul(mix(0.72, 1.0, fresh)).toVar();
  const yellow = yellowRaw.mul(keep).toVar();
  const paint = max(white, yellow).toVar();
  const paintCol = mix(vec3(0.6, 0.6, 0.57), vec3(0.6, 0.36, 0.06), step(white, yellow.sub(0.001)));
  albedo = mix(albedo, paintCol.mul(mix(0.55, 1.0, wear)).mul(mix(0.7, 1.0, grit)), paint.mul(0.93));
  rough = mix(rough, float(0.62), paint);
  porosity = mix(porosity, float(0.18), paint);
  nxy = mix(nxy, nxy.mul(0.25), paint);

  // ---- gutter strip (precast concrete) with running water + storm drains --------------------------------------
  const gw = 0.34;
  const gutter = aaStep(float(gw).sub(cd)).mul(aaStep(cd.add(0.02))).mul(curbed).toVar();
  const gTex = texture(T.concrete.c, vec2(along.div(1.4), cd.div(1.4).add(across.mul(0.0)))).rgb;
  const gN = texture(T.concrete.n, vec2(along.div(1.4), cd.div(1.4))).rg.mul(2).sub(1);
  const gJoint = aaBand(fract(along.div(1.0)).sub(0.5).abs().sub(0.5), 0.006);
  const gutCol = gTex.mul(vec3(0.55, 0.55, 0.56)).mul(mix(1.0, 0.4, gJoint)).mul(mix(0.55, 1.0, smoothstep(0.0, 0.12, cd)));
  albedo = mix(albedo, gutCol, gutter);
  rough = mix(rough, float(0.75), gutter);
  nxy = mix(nxy, gN.mul(0.5), gutter);
  // curb ambient occlusion on the road surface
  albedo = albedo.mul(mix(0.55, 1.0, smoothstep(0.0, 0.3, cd).max(curbed.oneMinus())));

  // storm drain grates in the gutter every 15m
  const dc = floor(along.div(15.0));
  const dLocal = along.sub(dc.mul(15.0).add(7.5));
  const grateIn = B(abs(dLocal).lessThan(0.3).and(cd.greaterThan(0.025)).and(cd.lessThan(gw - 0.01))).mul(gutter).toVar();
  const gUV = vec2(cd.sub(0.025).div(gw - 0.035), dLocal.div(0.6).add(0.5));
  const grC = texture(T.grate.c, gUV).rgb;
  const grN = texture(T.grate.n, gUV);
  const hole = smoothstep(0.12, 0.05, luma(grC)).mul(grateIn);
  albedo = mix(albedo, mix(grC.mul(0.9), vec3(0.004), hole), grateIn);
  rough = mix(rough, mix(float(0.42), float(0.9), hole), grateIn);
  metal = mix(metal, float(0.75).mul(hole.oneMinus()), grateIn);
  nxy = mix(nxy, grN.rg.mul(2).sub(1).mul(0.9), grateIn);
  porosity = mix(porosity, float(0.0), grateIn);

  // ---- manholes (avenue lane cells + cross street cells) ----------------------------------------------------
  const mCellA = floor(z.div(23.0));
  const mhA = hash23(vec2(mCellA, 5.3));
  const mcA = vec2(floor(mhA.x.mul(4)).mul(3).sub(4.5).add(mhA.y.sub(0.5).mul(0.7)), mCellA.mul(23).add(4).add(mhA.z.mul(15)));
  const mExA = step(0.3, hash21(vec2(mCellA, 9.1)));
  const mCellC = floor(x.div(23.0));
  const mhC = hash23(vec2(mCellC, zc.mul(0.1).add(1.7)));
  const mcC = vec2(mCellC.mul(23).add(4).add(mhC.z.mul(15)), zc.add(mix(-2.5, 2.5, step(0.5, mhC.x))).add(mhC.y.sub(0.5).mul(0.8)));
  const mExC = step(0.4, hash21(vec2(mCellC, zc)));
  const dA = select(mExA.greaterThan(0.5), length(P.sub(mcA)), float(99));
  const dC = select(mExC.greaterThan(0.5), length(P.sub(mcC)), float(99));
  const useA = B(dA.lessThan(dC));
  const mc = mix(mcC, mcA, useA);
  const md = min(dA, dC);
  const mR = 0.33;
  const mRot = hash21(mc.mul(1.3)).mul(6.283);
  const ml = P.sub(mc);
  const mlr = vec2(ml.x.mul(cos(mRot)).sub(ml.y.mul(sin(mRot))), ml.x.mul(sin(mRot)).add(ml.y.mul(cos(mRot))));
  const mUV = mlr.div(mR * 2.0).add(0.5);
  const mC = texture(T.manhole.c, mUV).rgb;
  const mN = texture(T.manhole.n, mUV);
  const mIn = aaStep(float(mR).sub(md)).mul(road).toVar();
  const mGap = aaBand(md.sub(mR), 0.008).mul(road);
  // square repair collar of fresher asphalt around each manhole
  const collarSd = sdBox2(ml, vec2(0.62));
  const collar = aaStep(collarSd.negate()).mul(road).mul(mIn.oneMinus());
  albedo = mix(albedo, sB.color.mul(0.6), collar.mul(0.8));
  albedo = mix(albedo, vec3(0.006), aaBand(collarSd, 0.02).mul(road).mul(0.85));
  albedo = mix(albedo, mC.mul(0.85), mIn);
  albedo = mix(albedo, vec3(0.003), mGap);
  rough = mix(rough, mix(float(0.55), float(0.3), mN.b), mIn);
  metal = mix(metal, mix(float(0.55), float(0.9), mN.b), mIn);
  nxy = mix(nxy, mN.rg.mul(2).sub(1), mIn);
  porosity = mix(porosity, float(0.0), mIn);

  // ---- puddles ---------------------------------------------------------------------------------------------
  const pn = fbm(P.mul(0.2).add(3.1), 4).add(fbm(P.mul(0.95).add(1.3), 2).sub(0.5).mul(0.22));
  const gutterProx = smoothstep(1.4, 0.0, cd).mul(curbed);
  const crownDry = smoothstep(4.5, 0.0, abs(across)).mul(road).mul(0.07);
  const level = pn.add(wheel.mul(0.11)).add(gutterProx.mul(0.26)).add(crack.mul(0.06)).add(patchSeam.mul(0.05)).sub(crownDry).sub(hAsph.sub(0.5).mul(0.06)).toVar();
  const puddle = smoothstep(0.672, 0.686, level).mul(grateIn.oneMinus()).toVar();
  // gutter running water: shallow sheet with downhill flow ripples
  const flowT = wetUniforms.time.mul(1.4);
  const fq = vec2(cd.mul(14.0), along.mul(2.5).sub(flowT.mul(2.0)));
  const fl = vec2(vnoise(fq).sub(0.5), vnoise(fq.add(vec2(5.2, 1.3)).mul(1.7)).sub(0.5)).mul(0.25);
  const flowN = vec2(mix(fl.y, fl.x, isAvF), mix(fl.x, fl.y, isAvF)).mul(gutter);
  const gutterWater = gutter.mul(smoothstep(0.35, 0.55, fbm(vec2(along.mul(0.08), 1.0), 2).add(0.15))).mul(grateIn.oneMinus());
  const pudAll = max(puddle, gutterWater.mul(0.9));

  const rip = rainRipples(P).add(flowN.mul(gutterWater));

  // micro roughness breakup so reflections streak and shimmer instead of a uniform mirror
  const microR = fbm(P.mul(1.9).add(7.0), 2);
  rough = rough.mul(mix(0.75, 1.25, microR));

  // partially drained / drying areas: rougher, less reflective
  const dryVar = smoothstep(0.35, 0.7, fbm(P.mul(0.06).add(21.0), 3)).mul(0.3);
  const L = wetLayer({ albedo, roughness: rough, nxy, porosity, puddle: pudAll, ripple: rip, filmRipple: 0.07, wetness: wetUniforms.wetness.mul(float(1).sub(dryVar)), film: [0.24, 0.04] });

  m.colorNode = L.albedo;
  m.roughnessNode = clamp(L.roughness, 0.012, 1);
  m.metalnessNode = metal.mul(mix(1.0, 0.6, L.puddle));
  m.normalNode = upNormalToView(L.nxy);
  m.userData.debug = { paint, white, yellow, whiteRaw, keep, puddle, cd, road, gutter, avLines, centerY, isAvF, inAv };
  return m;
}
