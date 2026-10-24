import * as THREE from 'three/webgpu';
import {
  pass, mrt, output, normalView, metalness, roughness, velocity, vec2, vec3, vec4, float, uniform,
  packNormalToRGB, unpackRGBToNormal, sample, renderOutput, screenUV, time, hash, mix, smoothstep, length,
  max, min, exp, dot, luminance, Fn, clamp, pow, abs, floor, fract, cameraViewMatrix, agxToneMapping, materialReference,
} from 'three/tsl';
import { ssr } from 'three/addons/tsl/display/SSRNode.js';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';
import { traa } from 'three/addons/tsl/display/TRAANode.js';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

// Post-processing pipeline (owned by the atmosphere workstream). HDR linear until renderOutput:
//   scene MRT (color, normal, metal/rough, velocity)
//   -> SSR (half res; wet dielectrics reflect, driven by roughness) + vertical "wet street" streak filter
//   -> depth-weighted atmospheric scattering (fog-scaled wide blur: lights diffuse into rainy haze)
//   -> TRAA -> bloom (soft wide halation) + subtle anamorphic streak
//   -> chromatic aberration -> exposure -> AgX -> cinematic grade (teal shadows / magenta highlights)
//   -> vignette + film grain
// Systems can tweak this.params at runtime (uniforms).
export class PostFX {
  constructor(renderer, scene, camera, ctx) {
    this.renderer = renderer; this.scene = scene; this.camera = camera; this.ctx = ctx;
    this.params = {
      exposure: uniform(0.84),
      bloomStrength: 0.10, bloomRadius: 0.42, bloomThreshold: 1.50,
      vignette: uniform(0.26),
      grain: uniform(0.008),
      chroma: uniform(0.00005),
      // extended (toned down for natural night-market lighting, avoiding cyberpunk glare)
      ssrIntensity: uniform(0.34),
      streak: uniform(0.18),
      scatter: uniform(0.035),
      scatterDist: uniform(0.0035),
      anamorphic: uniform(0.001),
      saturation: uniform(1.02),
      hueKeep: uniform(0.60),
      contrast: uniform(0.30),
      shadowTint: uniform(new THREE.Vector3(-0.002, 0.003, 0.006)),
      highlightTint: uniform(new THREE.Vector3(1.01, 0.99, 0.95)),
      lift: uniform(new THREE.Vector3(0.003, 0.003, 0.004)),
    };
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.0;
  }

  build() {
    const { renderer, scene, camera, params } = this;
    const pipeline = new THREE.RenderPipeline(renderer);
    pipeline.outputColorTransform = false;

    const scenePass = pass(scene, camera);
    // Transparent objects (rain, mist, glows) must NOT overwrite the G-buffer attachments, otherwise SSR/TRAA use
    // their normals/roughness against the opaque depth and smear. Write alpha=1 for opaque, 0 for transparent and
    // blend those attachments with NormalBlending (opaque overwrites, transparent keeps what's underneath).
    const opaqueW = float(1).sub(materialReference('transparent', 'float'));
    const gbufMRT = mrt({
      output,
      normal: vec4(packNormalToRGB(normalView), opaqueW),
      metalrough: vec4(metalness, roughness, 0, opaqueW),
      velocity: vec4(velocity, 0, opaqueW),
    });
    const keepBlend = new THREE.BlendMode(THREE.NormalBlending);
    gbufMRT.setBlendMode('normal', keepBlend);
    gbufMRT.setBlendMode('metalrough', keepBlend);
    gbufMRT.setBlendMode('velocity', keepBlend);
    scenePass.setMRT(gbufMRT);
    scenePass.getTexture('normal').type = THREE.UnsignedByteType;
    scenePass.getTexture('metalrough').type = THREE.UnsignedByteType;

    const color = scenePass.getTextureNode('output');
    const depth = scenePass.getTextureNode('depth');
    const normalTex = scenePass.getTextureNode('normal');
    const metalRough = scenePass.getTextureNode('metalrough');
    const vel = scenePass.getTextureNode('velocity');
    const normal = sample((u) => unpackRGBToNormal(normalTex.sample(u)));

    // --- SSR ---------------------------------------------------------------------------------------
    // Non-stochastic SSR weights hits by "metalness"; feed it a reflectivity term instead so smooth wet
    // dielectrics (asphalt puddles, glossy tiles, water) reflect strongly; grazing fresnel is applied inside.
    const rough = metalRough.g;
    // world-up in view space: horizontal (floor/puddle) surfaces reflect fully; walls/glass reflect less (grazing
    // SSR on vertical surfaces smears badly), rough surfaces get no SSR at all (env/PMREM covers them).
    const upView = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
    const upness = smoothstep(0.55, 0.9, dot(unpackRGBToNormal(normalTex), upView));
    const gloss = float(1).sub(smoothstep(0.04, 0.55, rough));
    const metalRefl = metalRough.r.mul(float(1).sub(smoothstep(0.15, 0.5, rough)));
    const reflectivity = max(metalRefl, gloss.mul(0.92)).mul(mix(0.3, 1.0, upness));
    const ssrPass = ssr(color, depth, normal, {
      metalnessNode: reflectivity,
      roughnessNode: rough.mul(0.6),
      reflectNonMetals: true,
      camera,
    });
    ssrPass.resolutionScale = 0.5;
    ssrPass.quality.value = 0.5;
    ssrPass.maxDistance.value = 140;
    ssrPass.thickness.value = 0.12;
    ssrPass.intensity.value = 1.0;
    ssrPass.maxLuminance.value = 40;
    ssrPass.screenEdgeFade.value = 0.12;
    ssrPass.blurQuality = 2;
    this.ssrPass = ssrPass;
    const ssrTex = ssrPass.getTextureNode();

    // Vertical streak filter: wet asphalt reflections stretch vertically on screen (anisotropic microfacets).
    const ssrStreak = Fn(() => {
      const uv0 = screenUV;
      const r = metalRough.sample(uv0).g;
      const upV = cameraViewMatrix.mul(vec4(0, 1, 0, 0)).xyz;
      const up = smoothstep(0.75, 0.97, dot(unpackRGBToNormal(normalTex.sample(uv0)), upV));
      const spread = mix(0.0016, 0.0085, smoothstep(0.02, 0.45, r)).mul(params.streak).mul(up).add(0.0004);
      const acc = vec3(ssrTex.sample(uv0).rgb).toVar();
      const px = floor(uv0.mul(vec2(1920, 1080)));
      const jit = fract(fract(px.x.mul(0.06711056).add(px.y.mul(0.00583715))).mul(52.9829189).add(fract(time.mul(7.13)).mul(3.0)));
      let wsum = 1.0;
      const N = 7;
      for (let k = 1; k <= N; k++) {
        const w = Math.exp(-(k * k) / (2 * (N * 0.5) * (N * 0.5)));
        const o = vec2(0, spread.mul(jit.add(k - 0.5)));
        acc.addAssign(ssrTex.sample(uv0.add(o)).rgb.add(ssrTex.sample(uv0.sub(o)).rgb).mul(w));
        wsum += 2 * w;
      }
      return acc.div(wsum);
    })();

    // debug flags: ?pfx=nossr,noscatter,nobloom,nostreak,notraa
    const dbg = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('pfx') || '' : '').split(',');
    this.dbg = dbg;
    if (dbg.includes('nostreak')) params.streak.value = 0;
    const lit = dbg.includes('nossr') ? color : color.add(ssrStreak.mul(params.ssrIntensity));

    // --- atmospheric scattering: light diffuses through rainy air proportional to distance ------------
    const blurred = gaussianBlur(lit, vec2(2.0), 6, { resolutionScale: 0.25 });
    const viewDist = scenePass.getViewZNode().negate();
    const scatterAmt = float(1).sub(exp(viewDist.mul(params.scatterDist).negate())).mul(params.scatter);
    const atmo = dbg.includes('noscatter') ? lit : mix(lit, blurred, scatterAmt).add(blurred.mul(0.03));

    // --- TRAA -------------------------------------------------------------------------------------------
    const aa = traa(atmo, depth, vel, camera);
    const aaTex = aa.getTextureNode();

    // --- bloom ------------------------------------------------------------------------------------------
    const bloomPass = bloom(aa, params.bloomStrength, params.bloomRadius, params.bloomThreshold);
    bloomPass.smoothWidth.value = 0.6;
    this.bloomPass = bloomPass;
    const bloomTex = bloomPass.getTextureNode();

    // subtle anamorphic horizontal streak from bloom (bright cores only)
    const anamorph = Fn(() => {
      const acc = vec3(0).toVar();
      let wsum = 0;
      const N = 10;
      for (let k = -N; k <= N; k++) {
        const w = Math.exp(-Math.abs(k) / 4.0);
        const s = bloomTex.sample(screenUV.add(vec2(k * 0.0075, 0))).rgb;
        acc.addAssign(max(s.sub(0.25), vec3(0)).mul(w));
        wsum += w;
      }
      return acc.div(wsum).mul(vec3(0.55, 0.65, 1.0));
    })();

    // --- chromatic aberration (radial, edges only) + composite --------------------------------------
    const cuv = screenUV.sub(0.5);
    const caOff = cuv.mul(dot(cuv, cuv)).mul(params.chroma.mul(16.0));
    const hdrAt = dbg.includes('nobloom') ? (u) => aaTex.sample(u).rgb : (u) => aaTex.sample(u).rgb.add(bloomTex.sample(u).rgb);
    const hdr = vec3(
      hdrAt(screenUV.sub(caOff)).r,
      hdrAt(screenUV).g,
      hdrAt(screenUV.add(caOff)).b,
    ).add(anamorph.mul(params.anamorphic.mul(10.0)));

    // AgX with partial hue preservation: pure AgX bleaches saturated neon to white too early; blending with a
    // max-channel (hue-preserving) AgX keeps signs coloured with only the hottest cores going white.
    const hdrC = max(hdr, vec3(0));
    const tmA = agxToneMapping(hdrC, params.exposure);
    const mx = max(max(hdrC.r, hdrC.g), max(hdrC.b, 1e-5));
    const tmM = agxToneMapping(vec3(mx), params.exposure).g;
    const tmH = hdrC.div(mx).mul(tmM);
    const tm = mix(tmA, tmH, params.hueKeep);
    const mapped = renderOutput(vec4(tm, 1.0), THREE.NoToneMapping, THREE.SRGBColorSpace);

    // --- display-space cinematic grade ------------------------------------------------------------------
    const grade = Fn(() => {
      const c = clamp(mapped.rgb, 0.0, 1.0).toVar();
      // gentle S-curve contrast
      c.assign(mix(c, c.mul(c).mul(float(3).sub(c.mul(2))), params.contrast));
      const lum = luminance(c);
      // split toning: teal/blue shadows, magenta-pink highlights
      const sh = pow(float(1).sub(lum), 3.0);
      c.addAssign(params.shadowTint.mul(sh));
      c.assign(mix(c, c.mul(params.highlightTint), smoothstep(0.35, 0.9, lum)));
      // saturation
      const l2 = luminance(c);
      c.assign(mix(vec3(l2), c, params.saturation));
      // lifted, blue-ish blacks (not crushed)
      c.addAssign(params.lift.mul(float(1).sub(c)));
      // vignette
      const d = length(screenUV.sub(0.5).mul(vec2(1.0, 0.85)));
      c.mulAssign(float(1).sub(smoothstep(0.3, 0.9, d).mul(params.vignette)));
      // film grain (luma-weighted, stronger in mids)
      const px = floor(screenUV.mul(vec2(1920, 1080)));
      const g = hash(px.x.add(px.y.mul(1931.0)).add(fract(time.mul(0.37)).mul(7919.0).floor().mul(2099.0))).sub(0.5);
      c.addAssign(g.mul(params.grain).mul(float(1).sub(abs(l2.sub(0.4)).mul(1.2)).max(0.3)));
      return vec4(max(c, vec3(0)), 1.0);
    })();

    pipeline.outputNode = grade;

    this.pipeline = pipeline;
    this.scenePass = scenePass;
  }

  render() {
    this.pipeline.render();
  }
}
