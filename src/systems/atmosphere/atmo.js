import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, uniform, texture, mix, smoothstep, exp, max, min, abs, cos, atan, dot, length,
  normalize, select, positionWorld, cameraPosition, output, normalWorldGeometry,
} from 'three/tsl';
import { createNoiseTexture } from './noiseTex.js';

// Shared atmosphere uniforms + TSL functions (sky, haze color, height fog).
// All colors are LINEAR HDR (pre-exposure, pre-AgX).
const v3 = (r, g, b) => uniform(new THREE.Vector3(r, g, b));

export const U = {
  // Horizon haze color = warm Jiangnan night market mist instead of purple cyberpunk smog
  fogColor: v3(0.065, 0.058, 0.075),
  midColor: v3(0.032, 0.034, 0.052),
  zenithColor: v3(0.008, 0.012, 0.022),
  glowMagenta: v3(0.09, 0.045, 0.025), // warm lantern amber glow instead of magenta
  glowOrange: v3(0.14, 0.075, 0.025),  // rich night-market golden lantern glow
  glowBlue: v3(0.018, 0.048, 0.065),   // gentle West Lake jade-blue reflection
  groundHaze: v3(0.075, 0.055, 0.042),
  skyBrightness: uniform(1.05),
  // Fog (softer, clearer Jiangnan evening air)
  fogDensity: uniform(0.0014),
  fogFalloff: uniform(0.032),
  fogBase: uniform(0.0),
  fogStart: uniform(22.0),
  hazeDensity: uniform(0.00012),
  fogMax: uniform(0.95),
  groundGlow: uniform(0.14),
  rain: uniform(0.35),
  // Clouds / weather
  cloudOffset: uniform(new THREE.Vector2(0, 0)),
  cloudCover: uniform(0.38),
  lightning: uniform(0.0),
  lightningDir: uniform(new THREE.Vector3(0.3, 0.35, -0.9).normalize()),
};

export const noiseTex = createNoiseTexture(256, 4242);

// Haze / light-pollution color in a given world direction (no clouds). Used by sky (horizon) AND fog so
// distant geometry dissolves seamlessly into the sky glow.
export const hazeColor = Fn(([dir]) => {
  const e = dir.y;
  const h = max(e, 0.0);
  const az = atan(dir.x, dir.z.negate()); // 0 = north (-Z), +PI/2 = east (+X)
  const c = mix(U.fogColor, U.midColor, smoothstep(0.0, 0.2, h)).toVar();
  c.assign(mix(c, U.zenithColor, smoothstep(0.1, 0.7, h)));
  const band = exp(h.mul(-7.0));
  const mag = cos(az.sub(0.3)).mul(0.5).add(0.5).pow(2.0);
  const or1 = cos(az.add(1.9)).mul(0.5).add(0.5).pow(3.0);
  const or2 = cos(az.add(0.6)).mul(0.5).add(0.5).pow(10.0);
  const blu = cos(az.sub(1.05)).mul(0.5).add(0.5).pow(8.0).add(cos(az.add(2.4)).mul(0.5).add(0.5).pow(4.0));
  c.addAssign(U.glowMagenta.mul(band).mul(mag.mul(0.75).add(0.25)));
  c.addAssign(U.glowOrange.mul(exp(h.mul(-13.0))).mul(or1.add(or2.mul(0.9))));
  c.addAssign(U.glowBlue.mul(exp(h.mul(-5.0))).mul(blu));
  // below the horizon: glowing ground haze of the city
  c.assign(mix(c, U.groundHaze.add(c.mul(0.5)), float(1).sub(smoothstep(-0.3, 0.0, e))));
  return c.mul(U.skyBrightness);
});

const lightningColor = vec3(0.55, 0.62, 1.0);

// Full sky: overcast low deck lit from below by the city.
export const skyColor = Fn(([dirIn]) => {
  const dir = normalize(dirIn);
  const e = dir.y;
  const h = max(e, 0.0);
  const p = dir.xz.div(h.add(0.07)).mul(0.22).add(U.cloudOffset);
  const n1 = texture(noiseTex, p).r;
  const n2 = texture(noiseTex, p.mul(2.3).add(U.cloudOffset.mul(0.6)).add(vec2(0.31, 0.77))).g;
  const n3 = texture(noiseTex, p.mul(6.1).add(vec2(0.53, 0.19))).b;
  const n = n1.mul(0.6).add(n2.mul(0.3)).add(n3.mul(0.1));
  const dens = smoothstep(U.cloudCover.sub(0.22), U.cloudCover.add(0.25), n);
  const haze = hazeColor(dir);
  // dense cloud = brighter underside (reflects city glow); thin areas show the darker deck above
  const billow = texture(noiseTex, p.mul(3.7).add(vec2(0.11, 0.42))).a;
  const lit = haze.mul(mix(0.35, 1.5, dens)).mul(billow.mul(0.35).add(0.82));
  const fade = smoothstep(0.0, 0.2, h);
  const c = mix(haze, lit, fade).toVar();
  // lightning: lights the cloud deck around the strike direction
  const ld = max(dot(dir, U.lightningDir), 0.0).pow(5.0);
  c.addAssign(lightningColor.mul(U.lightning).mul(ld.mul(2.5).add(0.25)).mul(dens.mul(0.8).add(0.3)));
  return c;
});

// Height + distance fog with neon-tinted inscatter. Assigned to scene.fogNode.
export const fogNodeFn = Fn(() => {
  const P = positionWorld;
  const cam = cameraPosition;
  const V = P.sub(cam);
  const dist = length(V).max(1e-3);
  const dir = V.div(dist);
  const fb = U.fogFalloff;
  const x = fb.mul(V.y);
  const fx = select(abs(x).greaterThan(0.0005), float(1).sub(exp(x.negate())).div(x), float(1).sub(x.mul(0.5)));
  const rainBoost = U.rain.mul(0.35).add(0.75);
  const gd = U.fogDensity.mul(exp(fb.mul(cam.y.sub(U.fogBase)).negate().min(8.0))).mul(rainBoost);
  // patchy drifting mist / rain sheets
  const nP = P.xz.mul(0.0035).add(U.cloudOffset.mul(4.0));
  const patch = texture(noiseTex, nP).r.mul(0.9).add(0.55);
  const fd = max(dist.sub(U.fogStart), 0.0);
  const optical = gd.mul(fd).mul(fx).mul(patch).add(U.hazeDensity.mul(rainBoost).mul(fd));
  const f = float(1).sub(exp(optical.negate())).min(U.fogMax);
  const fdir = normalize(vec3(dir.x, dir.y.mul(0.5), dir.z));
  const col = hazeColor(fdir).toVar();
  col.mulAssign(float(1).add(exp(max(P.y, 0.0).mul(-1 / 35)).mul(U.groundGlow)));
  const ld = max(dot(fdir, U.lightningDir), 0.0).pow(3.0);
  col.addAssign(lightningColor.mul(U.lightning).mul(ld.add(0.15)).mul(0.6));
  return vec4(mix(output.rgb, col, f), output.a);
});

// Background mesh: its normalWorldGeometry is the view direction (unit sphere around the camera).
export const backgroundNode = () => skyColor(normalWorldGeometry);
