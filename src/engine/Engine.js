import * as THREE from 'three/webgpu';
import RAPIER from '@dimforge/rapier3d-compat';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';
import { LAYOUT, SHOT_VIEWS } from '../world/layout.js';
import { Assets } from './Assets.js';
import { Input } from './Input.js';
import { PostFX } from './PostFX.js';

// Core engine. Systems are plain objects: { name, async init(ctx), update(dt, t, ctx), postUpdate?(dt, t, ctx) }.
// ctx is the shared context passed to every system (see below). Systems must only touch their own content.
export class Engine {
  constructor(container) {
    this.container = container;
    this.systems = [];
    const qs = new URLSearchParams(location.search);
    this.shot = qs.get('shot');
    this.shotFrames = parseInt(qs.get('frames') || '90', 10);
    this.quality = qs.get('q') || 'ultra';
  }

  async init(systems, onProgress = () => {}) {
    const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
    renderer.setPixelRatio(this.shot ? 1 : Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.toneMapping = THREE.NoToneMapping; // tone mapping is done in PostFX
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.lighting = new ClusteredLighting(); // supports hundreds of point lights (neon, lanterns, street lamps)
    this.container.appendChild(renderer.domElement);
    await renderer.init();
    if (!renderer.backend.isWebGPUBackend) console.warn('[engine] WebGPU unavailable, running on WebGL2 fallback');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 4000);
    const sp = LAYOUT.spawn.position;
    camera.position.set(sp[0], sp[1], sp[2]);
    scene.add(camera);

    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });

    this.renderer = renderer; this.scene = scene; this.camera = camera;
    this.timer = new THREE.Timer();
    this.time = 0;
    this.frame = 0;

    this.ctx = {
      THREE, renderer, scene, camera, engine: this,
      physics: { RAPIER, world },
      layout: LAYOUT,
      assets: new Assets(renderer),
      input: new Input(renderer.domElement, !!this.shot),
      isShot: !!this.shot,
      quality: this.quality,
      // Global weather state shared by materials/particles/audio. Gentle Hangzhou Jiangnan drizzle by default.
      weather: { rain: 0.35, wetness: 0.65, wind: new THREE.Vector2(0.22, -0.10), lightning: 0 },
      // Uniform-style shared time for TSL shaders: import { time } from 'three/tsl' is also available.
      cameraMode: this.shot ? 'shot' : 'player',
      // Simple event bus
      events: new EventTarget(),
      // Systems can expose APIs here by name, e.g. ctx.api.vehicles.spawnTraffic()
      api: {},
      postfx: null,
    };

    this.postfx = new PostFX(renderer, scene, camera, this.ctx);
    this.ctx.postfx = this.postfx;

    for (let i = 0; i < systems.length; i++) {
      const s = systems[i];
      const t0 = performance.now();
      try {
        await s.init?.(this.ctx);
      } catch (e) {
        console.error(`[engine] system "${s.name}" failed to init`, e);
        s._failed = true;
      }
      console.log(`[engine] ${s.name} init ${(performance.now() - t0).toFixed(0)}ms`);
      this.systems.push(s);
      onProgress((i + 1) / systems.length, s.name);
    }

    this.postfx.build();

    if (this.shot) this.applyShotView(this.shot);

    window.addEventListener('resize', () => this.resize());
    window.__engine = this;
    window.__ctx = this.ctx;

    await this.precompile(onProgress);
  }

  // Compile every pipeline the game will use, asynchronously and in parallel, before the first frame.
  // Pipelines are keyed by render target formats + MRT, so we must compile against the PostFX scene pass (not the
  // canvas), and with frustum culling off so objects outside the initial view are included too.
  async precompile(onProgress) {
    const { renderer, scene, camera } = this;
    const t0 = performance.now();
    const sp = this.postfx.scenePass;
    const culled = [];
    scene.traverse((o) => { if (o.frustumCulled) { o.frustumCulled = false; culled.push(o); } });
    const prevRT = renderer.getRenderTarget(), prevMRT = renderer.getMRT();
    try {
      renderer.setRenderTarget(sp.renderTarget);
      renderer.setMRT(sp.getMRT());
      await renderer.compileAsync(scene, camera, null, (e) => onProgress(e.total ? e.loaded / e.total : 1, `compiling shaders ${e.loaded}/${e.total}`));
    } catch (e) {
      console.warn('[engine] precompile failed', e);
    } finally {
      renderer.setRenderTarget(prevRT);
      renderer.setMRT(prevMRT);
      for (const o of culled) o.frustumCulled = true;
    }
    for (const s of this.systems) {
      if (s._failed || !s.precompile) continue;
      try { await s.precompile(this.ctx); } catch (e) { console.warn(`[engine] ${s.name}.precompile failed`, e); }
    }
    console.log(`[engine] shader precompile ${(performance.now() - t0).toFixed(0)}ms`);
  }

  applyShotView(name) {
    const v = SHOT_VIEWS[name];
    if (!v) { console.error('[engine] unknown shot view', name); return; }
    this.camera.position.set(...v.pos);
    this.camera.fov = v.fov;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(new THREE.Vector3(...v.look));
    this.ctx.cameraMode = 'shot';
    document.body.classList.add('shot');
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  start() {
    const step = 1 / 60;
    let acc = 0;
    this.renderer.setAnimationLoop(() => {
      // Deterministic timestep in shot mode so screenshots are reproducible
      this.timer.update();
      const dt = this.shot ? step : Math.min(this.timer.getDelta(), 0.1);
      this.time += dt;
      acc += dt;
      while (acc >= step) {
        this.ctx.physics.world.timestep = step;
        this.ctx.physics.world.step();
        acc -= step;
      }
      for (const s of this.systems) if (!s._failed && s.update) {
        try { s.update(dt, this.time, this.ctx); } catch (e) { console.error(`[engine] ${s.name}.update`, e); s._failed = true; }
      }
      for (const s of this.systems) if (!s._failed && s.postUpdate) s.postUpdate(dt, this.time, this.ctx);
      if (this.shot) this.applyShotView(this.shot);
      this.ctx.input.endFrame();
      this.postfx.render(dt);
      this.frame++;
      if (this.shot && this.frame === this.shotFrames) window.__shotReady = true;
    });
  }
}
