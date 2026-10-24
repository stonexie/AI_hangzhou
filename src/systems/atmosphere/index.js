// Atmosphere system: night sky (overcast deck lit by city glow), height/distance fog with neon inscatter,
// procedural neon-city PMREM environment, weak cool ambient, lightning response, light-shaft helper.
// Post-processing lives in src/engine/PostFX.js (also owned by this workstream).
import * as THREE from 'three/webgpu';
import { U, backgroundNode, fogNodeFn, hazeColor } from './atmo.js';
import { buildEnvironment } from './environment.js';
import { createLightShaft } from './lightShaft.js';

const BASE = {
  envIntensity: 0.3,
  hemi: 0.12,
};

export default {
  async init(ctx) {
    const { scene, renderer } = ctx;

    scene.background = null;
    scene.backgroundNode = backgroundNode();
    scene.fogNode = fogNodeFn();

    try {
      scene.environment = buildEnvironment(renderer);
      scene.environmentIntensity = BASE.envIntensity;
    } catch (e) {
      console.warn('[atmosphere] environment PMREM failed', e);
    }

    // weak cool sky / dark warm ground ambient
    this.hemi = new THREE.HemisphereLight(0x4a5a9a, 0x1a1020, BASE.hemi);
    this.hemi.name = 'atmo.hemi';
    scene.add(this.hemi);

    this.ctx = ctx;
    // debug: ?atmoflash=0.8 forces a lightning flash level (for tuning screenshots)
    this.forceFlash = parseFloat(new URLSearchParams(location.search).get('atmoflash') || '0');
    this.flash = 0;
    ctx.api.atmosphere = {
      fogColor: U.fogColor,
      fogDensity: U.fogDensity,
      uniforms: U,
      hazeColor,
      lightning: 0,
      createLightShaft: (opts) => createLightShaft(opts),
    };

    if (typeof location !== 'undefined' && location.search.includes('atmotest')) {
      const { buildTestScene } = await import('./testScene.js');
      buildTestScene(ctx);
      console.log('[atmosphere] atmotest scene enabled');
    }
  },

  update(dt, t, ctx) {
    const w = ctx.weather || {};
    // cloud drift with wind
    const wind = w.wind || { x: 0.6, y: -0.25 };
    U.cloudOffset.value.x += wind.x * dt * 0.0018;
    U.cloudOffset.value.y += wind.y * dt * 0.0018;
    U.rain.value = w.rain ?? 1;

    // lightning: weather system sets w.lightning (0..1). Fast attack, short decay, flickery.
    const target = this.forceFlash ? this.forceFlash : (w.lightning || 0);
    this.flash = target > this.flash ? target : Math.max(target, this.flash - dt * 6);
    const f = this.flash;
    U.lightning.value = f * 1.6;
    ctx.api.atmosphere.lightning = f;
    ctx.scene.environmentIntensity = BASE.envIntensity * (1 + f * 3);
    if (this.hemi) {
      this.hemi.intensity = BASE.hemi * (1 + f * 8);
    }
  },
};
