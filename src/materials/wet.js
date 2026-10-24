// Shared wet-surface TSL helpers (owned by the ground workstream). Import from any system:
//
//   import { applyWetness, wetUniforms } from '../../materials/wet.js';
//   applyWetness(myStandardNodeMaterial, { porosity: 0.3, puddles: 0.6, ripples: 1, streaks: 1 });
//
// applyWetness() wraps the material's existing colorNode/roughnessNode/normalNode (or color/map/roughness/normalMap)
// with a physically-motivated wet layer (Lagarde, "Water drop" series):
//   - porous darkening of albedo, roughness pulled toward a thin water film (low roughness -> SSR picks it up)
//   - optional puddles on up-facing surfaces (near-mirror, flat normal, darker albedo) with animated rain ripples
//   - optional rain streaks / drip trails on vertical surfaces
// Global wetness / rain intensity come from wetUniforms (driven every frame from ctx.weather by the ground system).
//
// Lower-level building blocks (used by the ground materials):
//   rainRipples(xz, { intensity, scale })  -> vec2 normal perturbation (world X/Z)
//   wetLayer({ albedo, roughness, nxy, porosity, wetness, puddle, ripple }) -> { albedo, roughness, nxy }
//   upNormalToView(nxy)  -> view-space normal for a horizontal surface with world-space perturbation nxy (x,z)
import * as THREE from 'three/webgpu';
import {
  float, vec2, vec3, vec4, uniform, time, fract, floor, length, exp, cos, sin, mix, smoothstep, clamp, max, min, abs, dot, sqrt,
  normalize, normalWorldGeometry, normalViewGeometry, positionWorld, cameraViewMatrix, materialColor, materialRoughness,
  normalMap, texture, select,
} from 'three/tsl';
import { hash23, hash21, vnoise, fbm } from './noise.js';

export const wetUniforms = {
  wetness: uniform(1.0),  // 0 dry .. 1 soaked
  rain: uniform(1.0),     // rain intensity (ripple spawn rate)
  time,                   // seconds (TSL global timer)
};

// Called once per frame by the ground system (safe to call from elsewhere too).
export function updateWetUniforms(weather) {
  if (!weather) return;
  if (Number.isFinite(weather.wetness)) wetUniforms.wetness.value = weather.wetness;
  if (Number.isFinite(weather.rain)) wetUniforms.rain.value = weather.rain;
}

// ---------------------------------------------------------------------------------------------------------
// Rain ripples: several layers of jittered cells, each cell spawns an expanding damped ring.
// xz: world-space vec2 (meters). Returns vec2 perturbation of the horizontal normal (≈ -slope).
export function rainRipples(xz, { intensity = 1.0, scale = 1.0, rain = wetUniforms.rain, t = wetUniforms.time } = {}) {
  let g = vec2(0);
  const layers = [
    { cell: 0.42, off: [0.0, 0.0], rate: 1.15 },
    { cell: 0.37, off: [0.37, 0.71], rate: 1.35 },
    { cell: 0.51, off: [0.83, 0.19], rate: 0.95 },
    { cell: 0.31, off: [0.13, 0.52], rate: 1.55 },
  ];
  layers.forEach((L, i) => {
    const cs = 1 / (L.cell * scale);
    const q = xz.mul(cs).add(vec2(L.off[0] * 17.0, L.off[1] * 17.0));
    const id = floor(q);
    const f = fract(q).sub(0.5);
    const h = hash23(id.add(i * 31.7));
    const c = h.xy.sub(0.5).mul(0.36);
    const ph = fract(t.mul(L.rate).add(h.z));                 // life 0..1
    const active = smoothstep(h.x.mul(0.6).add(0.2), h.x.mul(0.6).add(0.3), rain); // fewer drops in light rain
    const dv = f.sub(c);
    const d = length(dv);
    const r = ph.mul(0.32);                                    // ring radius (cell units)
    const x = d.sub(r);
    const env = exp(x.mul(x).mul(-900)).mul(float(1).sub(ph).pow(2.2)).mul(smoothstep(0.0, 0.04, ph));
    const freq = 80.0;
    const dh = cos(x.mul(freq)).mul(env).mul(active);         // d(height)/d(dist), arbitrary units
    const dir = dv.div(max(d, 1e-3));
    g = g.add(dir.mul(dh));
  });
  return g.mul(0.22 * intensity).negate();
}

// Core wet layer. All inputs are nodes. nxy = horizontal part of the world normal (x, z).
//   porosity: 0 (glass/metal/paint) .. 1 (concrete/asphalt)
//   puddle: 0..1 standing water depth mask
//   ripple: vec2 ripple perturbation (from rainRipples) or null
export function wetLayer({ albedo, roughness, nxy, porosity = 0.7, wetness = wetUniforms.wetness, puddle = float(0), ripple = null, filmRipple = 0.18, film = [0.2, 0.035] }) {
  const w = clamp(wetness, 0, 1);
  const por = float(porosity);
  // porous surfaces darken strongly when soaked; non porous barely
  const dark = mix(float(1), mix(0.88, 0.42, por), w);
  const a1 = albedo.mul(dark);
  // water film: roughness collapses toward a low value, keeping some of the original variation for streaky breakup
  const filmR = clamp(roughness.mul(film[0]).add(film[1]), 0.02, 0.5);
  const r1 = mix(roughness, filmR, w.mul(mix(0.85, 1.0, por)));
  // water fills micro relief
  let n1 = nxy.mul(mix(float(1), float(0.42), w));
  if (ripple) n1 = n1.add(ripple.mul(filmRipple).mul(w));
  // puddles
  const p = clamp(puddle, 0, 1).mul(w);
  const a2 = a1.mul(mix(float(1), float(0.5), p));
  const r2 = mix(r1, float(0.012), smoothstep(0.0, 0.6, p));
  let n2 = mix(n1, vec2(0), smoothstep(0.0, 0.5, p));
  if (ripple) n2 = n2.add(ripple.mul(p));
  return { albedo: a2, roughness: r2, nxy: n2, puddle: p };
}

// View-space normal for an (approximately) horizontal, up-facing surface given world perturbation nxy (x,z).
export function upNormalToView(nxy) {
  const ny = sqrt(max(float(1).sub(dot(nxy, nxy)), 0.04));
  const nW = normalize(vec3(nxy.x, ny, nxy.y));
  return normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);
}

// Procedural puddle mask for arbitrary up-facing surfaces (world xz meters). amount 0..1 = coverage.
export function puddleMask(xz, amount = 0.5, scale = 1.0) {
  const n = fbm(xz.mul(0.35 / scale), 4);
  const thr = mix(0.78, 0.45, amount);
  return smoothstep(thr, thr + 0.06, n);
}

// ---------------------------------------------------------------------------------------------------------
// High-level helper for any MeshStandardNodeMaterial / MeshPhysicalNodeMaterial.
// opts: { wetness (node|number), porosity, puddles (0..1 coverage on up-facing faces), ripples (0..1),
//         streaks (0..1 rain streaks on vertical faces), minRoughness, scale }
export function applyWetness(material, opts = {}) {
  const {
    wetness = wetUniforms.wetness, porosity = 0.5, puddles = 0, ripples = 1, streaks = 0.6, scale = 1, minRoughness = 0.02,
  } = opts;
  const wN = typeof wetness === 'number' ? float(wetness) : wetness;
  const base = vec4(material.colorNode ?? materialColor);
  const rough = float(material.roughnessNode ?? materialRoughness);
  const nG = normalWorldGeometry;
  const up = smoothstep(0.65, 0.95, nG.y);
  const vertical = float(1).sub(smoothstep(0.3, 0.7, abs(nG.y)));
  const P = positionWorld;

  // rain streaks: vertical runs of darker, glossier wet material on walls
  let streakMask = float(0);
  if (streaks > 0) {
    const u = P.x.add(P.z).mul(9.0 / scale);
    const col = floor(u);
    const rnd = hash21(vec2(col, 7.0));
    const v = P.y.mul(0.6 / scale).add(rnd.mul(10));
    const s = vnoise(vec2(u.mul(1.0), v)).mul(vnoise(vec2(col.mul(0.37), P.y.mul(0.15 / scale))));
    streakMask = smoothstep(0.25, 0.55, s).mul(vertical).mul(streaks);
  }
  const pud = puddles > 0 ? puddleMask(P.xz, puddles, scale).mul(up) : float(0);
  const rip = ripples > 0 ? rainRipples(P.xz, { intensity: ripples, scale }) : null;
  const effWet = clamp(wN.mul(mix(float(0.75), float(1.0), up.max(streakMask))), 0, 1);
  const L = wetLayer({ albedo: base.rgb, roughness: rough, nxy: vec2(0), porosity, wetness: effWet, puddle: pud, ripple: rip ? rip.mul(up) : null, filmRipple: 0.12 });

  material.colorNode = vec4(L.albedo.mul(mix(float(1), float(0.85), streakMask)), base.a);
  material.roughnessNode = max(mix(L.roughness, L.roughness.mul(0.5), streakMask), minRoughness);

  if (rip || puddles > 0) {
    let nBase;
    if (material.normalNode) nBase = material.normalNode;
    else if (material.normalMap) nBase = normalMap(texture(material.normalMap), uniform(material.normalScale ?? new THREE.Vector2(1, 1)));
    else nBase = normalViewGeometry;
    const pert = cameraViewMatrix.mul(vec4(L.nxy.x, 0, L.nxy.y, 0)).xyz.mul(up);
    // flatten toward the geometric normal inside puddles
    const flat = mix(nBase, normalViewGeometry, smoothstep(0.0, 0.5, L.puddle));
    material.normalNode = normalize(flat.add(pert));
  }
  material.needsUpdate = true;
  return material;
}
