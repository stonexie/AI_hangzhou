// Weather system (owned by the "weather" workstream): GPU compute rain, splashes, drips/streams, steam/mist,
// lightning. Exposes ctx.api.weather = { setRain(v), rain, setWind(x,z), strike() } and drives ctx.weather.
import * as THREE from 'three/webgpu';
import { U } from './common.js';
import { HeightField } from './heightfield.js';
import { LightGather } from './lights.js';
import { Rain } from './rain.js';
import { Splashes } from './splashes.js';
import { Lightning } from './lightning.js';
import { Drips } from './drips.js';
import { Steam, steamEmitters } from './steam.js';

const S = {};

export default {
  async init(ctx) {
    const { scene, renderer, camera } = ctx;
    const q = ctx.quality;
    const scale = q === 'low' ? 0.35 : q === 'medium' ? 0.6 : 1.0;

    if (new URLSearchParams(location.search).get('wxtest')) {
      const { buildTestScene } = await import('./testscene.js');
      buildTestScene(ctx);
    }

    S.group = new THREE.Group();
    S.group.name = 'weather';
    scene.add(S.group);

    camera.updateMatrixWorld();
    U.cam.value.setFromMatrixPosition(camera.matrixWorld);
    S.prevCam = U.cam.value.clone();

    S.hf = new HeightField(ctx);
    S.hf.hideList.push(S.group);
    S.lights = new LightGather(ctx);
    S.splashes = new Splashes(ctx);
    S.rain = new Rain(ctx, {
      heightField: S.hf, lights: S.lights, splashes: S.splashes,
      nearCount: Math.round(14000 * scale), midCount: Math.round(68000 * scale), farCount: Math.round(55000 * scale),
    });
    S.drips = new Drips(ctx, { heightField: S.hf, lights: S.lights, splashes: S.splashes, drips: Math.round(2800 * scale) });
    S.steam = new Steam(ctx, { emitters: steamEmitters(ctx), lights: S.lights, perEmitter: q === 'low' ? 24 : 48 });
    S.group.add(S.rain.mesh, S.splashes.mesh, S.drips.mesh, S.steam.mesh);
    // dev: ?wxoff=1 hides weather rendering + compute (perf A/B), ?wxoff=rain,splash for parts
    const off = (new URLSearchParams(location.search).get('wxoff') || '').split(',');
    S.off = (k) => off.includes('1') || off.includes(k);
    if (S.off('rain')) S.rain.mesh.visible = false;
    if (S.off('splash')) S.splashes.mesh.visible = false;
    if (S.off('drips')) S.drips.mesh.visible = false;
    if (S.off('steam')) S.steam.mesh.visible = false;
    S.splashes.init?.(renderer);
    S.rain.init(renderer);
    S.drips.init(renderer);

    S.lightning = new Lightning(ctx);
    S.targetRain = ctx.weather.rain ?? 0.35;

    ctx.api.weather = {
      get rain() { return ctx.weather.rain; },
      setRain(v) { S.targetRain = Math.max(0, Math.min(1, v)); },
      setWind(x, z) { ctx.weather.wind.set(x, z); },
      strike(intensity = 1) { S.lightning.enabled = true; S.lightning.trigger(ctx.engine.time, intensity); },
      uniforms: U,
    };
    S.ctx = ctx;
    window.__weather = S; // debug handle
  },

  update(dt, t, ctx) {
    const { renderer, camera } = ctx;
    const w = ctx.weather;
    // rain intensity easing
    w.rain += (S.targetRain - w.rain) * Math.min(1, dt * 0.5);
    w.wetness += ((w.rain > 0.05 ? 0.68 : 0) - w.wetness) * Math.min(1, dt * (w.rain > 0.05 ? 0.2 : 0.02));
    // gentle Jiangnan breeze instead of harsh storm gusts
    const gust = 0.75 + 0.18 * Math.sin(t * 0.32) + 0.12 * Math.sin(t * 0.85 + 1.3);
    U.gust.value = gust;
    U.wind.value.set(w.wind.x * 1.1, w.wind.y * 1.1);
    U.rain.value = w.rain;
    w.lightning = S.lightning.update(dt, t, w.rain);
    if (ctx.api.atmosphere && 'lightning' in ctx.api.atmosphere && typeof ctx.api.atmosphere.lightning !== 'object') ctx.api.atmosphere.lightning = w.lightning;
    U.lightning.value = w.lightning;
    // ambient particle colour from fog colour (if atmosphere exposes it)
    const fc = ctx.api.atmosphere?.fogColor?.value;
    if (fc && fc.isColor) U.ambient.value.copy(fc).multiplyScalar(1.6).addScalar(0.006);
    else U.ambient.value.setRGB(0.045, 0.05, 0.075);

    U.time.value = t;
    U.dt.value = Math.min(dt, 1 / 20);
    U.frame.value = (U.frame.value + 1) % 100000;
  },

  postUpdate(dt, t, ctx) {
    // runs after the player/camera has moved this frame
    const { renderer, camera } = ctx;
    camera.updateMatrixWorld();
    const cp = (S._cp ||= new THREE.Vector3()).setFromMatrixPosition(camera.matrixWorld);
    U.cam.value.copy(cp);
    const v = new THREE.Vector3().subVectors(cp, S.prevCam).divideScalar(Math.max(dt, 1e-3));
    if (v.length() > 80) v.set(0, 0, 0); // teleport
    U.camVel.value.lerp(v, Math.min(1, dt * 8));
    S.prevCam.copy(cp);
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    U.pixK.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, size.y);

    if (S.off('1') || S.paused) return;
    S.hf.update();
    S.lights.update(t);
    S.rain.update(renderer);
    S.drips.update(renderer);
  },
};
