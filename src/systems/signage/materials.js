// TSL node materials for signage. All sign faces share ONE material (mode selected per-vertex).
import * as THREE from 'three/webgpu';
import {
  attribute, texture, uniform, float, vec2, vec3, vec4, mix, step, smoothstep, clamp, hash, floor, fract, sin, cos, abs,
  max, min, pow, uv, positionLocal, positionWorld, normalWorld, cameraPosition, dot, length, select, Fn, normalize, exp,
} from 'three/tsl';

export const uTime = uniform(0);
export const uWind = uniform(0.6);

// ---- flicker helpers (deterministic, driven by uTime)
// type 0 steady, 1 stutter (occasional bursts), 2 broken segments, 3 chase/sequence, 4 slow breathe
// NOTE: TSL hash() truncates its input to uint, so all hash inputs are built from integers (seed is an integer id).
// js twin: flickerJS() in lights.js (must stay in sync for the light-pool so cast light flickers with the sign).
export function flickerNode(seed, type, seg) {
  const t = uTime;
  const burstWin = hash(floor(t.mul(0.7)).add(seed.mul(7919)));
  const fast = hash(floor(t.mul(23.0)).add(seed.mul(4999)).add(seg.mul(1597)));
  const stutter = select(burstWin.greaterThan(0.72), step(0.38, fast).mul(0.92).add(0.08), float(1));
  const segH = hash(seg.mul(613).add(seed.mul(2851)));
  const segDead = step(0.16, segH); // 16% of segments dead on "broken" signs
  const segFlick = select(segH.lessThan(0.3), step(0.45, hash(floor(t.mul(15.0)).add(seg.mul(977)).add(seed.mul(31)))), float(1));
  const broken = max(segDead.mul(segFlick), float(0.025));
  const ph = fract(t.mul(0.45).sub(seg.mul(0.11)).add(seed.mul(0.137)));
  const chase = smoothstep(0.0, 0.08, ph).mul(step(ph, 0.72)).max(0.05);
  const breathe = sin(t.mul(1.7).add(seed.mul(0.4))).mul(0.18).add(0.86);
  const r = select(type.lessThan(0.5), float(1),
    select(type.lessThan(1.5), stutter,
      select(type.lessThan(2.5), broken.mul(stutter.mul(0.3).add(0.7)),
        select(type.lessThan(3.5), chase, breathe))));
  return r;
}

// Faces: attributes
//   uv     atlas uv
//   tint   vec3 neon colour (mode 0/2/4) or multiplier (mode 1)
//   sp     vec4(mode, intensity, seed, flickerType)
//   back   vec3 albedo of the backing panel
// modes: 0 neon tube mask on dark backing, 1 colour light box (diffuser), 2 solid emissive (LED strip),
//        3 painted / unlit print (poster, road sign; tiny emissive), 4 LED channel letters (filled), 5 screen (colour atlas, pixel grid)
export function makeFaceMaterial(neonTex, colorTex) {
  const m = new THREE.MeshStandardNodeMaterial();
  const auv = uv();
  const tint = attribute('tint', 'vec3');
  const sp = attribute('sp', 'vec4');
  const back = attribute('back', 'vec3');
  const rawMode = sp.x, inten = sp.y, seed = sp.z, ftype = sp.w;
  // modes >= 6 are "open" variants (no backing panel: discarded where there is no tube/letter)
  const open = rawMode.greaterThan(5.5);
  const mode = select(open, rawMode.sub(6.0), rawMode);

  const nm = texture(neonTex, auv);
  const cm = texture(colorTex, auv);
  const tube = nm.r, halo = nm.g, seg = floor(nm.b.mul(255.0).add(0.5));

  const on = flickerNode(seed, ftype, seg);
  const onBox = flickerNode(seed, select(ftype.greaterThan(1.5).and(ftype.lessThan(2.5)), float(1), ftype), float(0));

  // neon tube: crisp glass edge, colour body, white-hot core
  const edge = smoothstep(0.1, 0.42, tube);
  const core = smoothstep(0.62, 0.95, tube);
  const tubeCol = tint.mul(edge).mul(1.0).add(vec3(1.0, 0.95, 0.92).mul(core).mul(0.55).add(tint.mul(core).mul(0.6)));
  const unlitGlass = vec3(0.05, 0.05, 0.055).mul(edge); // dead tube looks like pale glass
  const neonE = tubeCol.mul(inten).mul(on).add(tint.mul(halo).mul(inten).mul(on).mul(0.06));

  // light box: diffuser with fluorescent tube banding + hot centre falloff
  // luv = local metres (x, y, w, h) of the face
  const luv = attribute('luv', 'vec4');
  const lx = luv.x, ly = luv.y, lw = max(luv.z, 0.01), lh = max(luv.w, 0.01);
  const edgeD = min(min(lx, lw.sub(lx)), min(ly, lh.sub(ly)));
  const vign = smoothstep(0.0, 0.14, edgeD).mul(0.4).add(0.6);
  // fluorescent tubes run along the long axis behind the diffuser
  const across = select(lw.greaterThan(lh), ly, lx);
  const band = cos(across.mul(Math.PI * 2 / 0.24)).mul(0.07).add(0.93);
  // grime: dead bugs / dirt collect at the bottom, mottled dust
  const cellN = hash(floor(lx.mul(7.0)).add(floor(ly.mul(7.0)).mul(131)).add(seed.mul(17)));
  const dirt = float(1).sub(smoothstep(0.35, 0.0, ly).mul(0.3)).mul(cellN.mul(0.12).add(0.88));
  const boxE = cm.rgb.mul(cm.rgb).mul(tint).mul(inten).mul(band).mul(vign).mul(dirt).mul(onBox);

  // channel letters (filled LED glyphs) – mask R is solid inside
  const chanE = tint.mul(smoothstep(0.25, 0.6, tube)).mul(inten).mul(on).add(tint.mul(halo).mul(inten).mul(on).mul(0.05));
  // solid strip
  const solidE = tint.mul(inten).mul(onBox);
  // screen: colour atlas + scanline/pixel grid
  const scr = cm.rgb.mul(cm.rgb).mul(inten).mul(onBox);

  const isNeon = mode.lessThan(0.5);
  const isBox = mode.greaterThan(0.5).and(mode.lessThan(1.5));
  const isSolid = mode.greaterThan(1.5).and(mode.lessThan(2.5));
  const isPaint = mode.greaterThan(2.5).and(mode.lessThan(3.5));
  const isChan = mode.greaterThan(3.5).and(mode.lessThan(4.5));

  const emissiveN = select(isNeon, neonE, select(isBox, boxE, select(isSolid, solidE, select(isPaint, cm.rgb.mul(cm.rgb).mul(inten), select(isChan, chanE, scr)))));
  const albedo = select(isNeon.or(isChan), back.add(unlitGlass), select(isPaint, cm.rgb.mul(cm.rgb).mul(tint), vec3(0.02)));
  m.maskNode = open.not().or(tube.greaterThan(0.07));
  m.colorNode = albedo;
  m.emissiveNode = emissiveN.mul(0.55);
  m.roughnessNode = select(isPaint, float(0.55), float(0.35));
  m.metalnessNode = select(isNeon.or(isChan), float(0.35), float(0.0));
  return m;
}

// Housings / brackets / poles: vertex colour + per-vertex metal/rough, with procedural grime streaks.
export function makeHousingMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const col = attribute('col', 'vec3');
  const mr = attribute('mr', 'vec2');
  const pw = positionWorld;
  const n1 = hash(floor(pw.x.mul(3.1)).add(floor(pw.z.mul(3.1)).mul(17.0)).add(floor(pw.y.mul(0.6)).mul(5.0)));
  const streak = hash(floor(pw.x.mul(9.0).add(pw.z.mul(9.0))));
  const grime = mix(float(0.75), float(1.05), n1).mul(mix(float(0.85), float(1.0), streak));
  m.colorNode = col.mul(grime);
  m.metalnessNode = mr.x;
  m.roughnessNode = clamp(mr.y.mul(mix(float(0.7), float(1.2), streak)), 0.05, 1.0);
  return m;
}
