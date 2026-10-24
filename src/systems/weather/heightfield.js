// Top-down "rain occlusion" height capture.
// Renders the scene from an orthographic camera above the player into a float target storing world Y of the
// highest surface. Rain/drip compute shaders sample it to: stop rain under awnings / overpasses / inside buildings,
// spawn splashes on whatever surface is hit (roofs, car roofs, awnings, ground), and find drip edges.
import * as THREE from 'three/webgpu';
import { positionWorld, vec4, float, texture, uniform, vec2, clamp, select } from 'three/tsl';

export class HeightField {
  constructor(ctx, { size = 112, res = 1024, above = 120, depth = 260, snap = 4 } = {}) {
    this.ctx = ctx;
    this.size = size; this.res = res; this.above = above; this.depth = depth; this.snap = snap;
    this.rt = new THREE.RenderTarget(res, res, { type: THREE.FloatType, depthBuffer: true });
    this.rt.texture.minFilter = THREE.NearestFilter;
    this.rt.texture.magFilter = THREE.NearestFilter;
    this.rt.texture.generateMipmaps = false;
    this.rt.texture.name = 'weatherHeight';
    const h = size / 2;
    this.cam = new THREE.OrthographicCamera(-h, h, h, -h, 0.1, depth);
    this.cam.up.set(0, 0, -1);
    this.mat = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    this.mat.outputNode = vec4(positionWorld.y, 0, 0, 1);
    this.mat.fog = false;
    this.mat.toneMapped = false;
    // origin (xz of capture center) as uniform, consumed by samplers
    this.origin = uniform(new THREE.Vector2(1e6, 1e6));
    this.invSize = uniform(1 / size);
    this.center = new THREE.Vector2(1e6, 1e6);
    this.hideList = [];
    this.framesSince = 1e9;
    this.clearColor = new THREE.Color(-1000, 0, 0);
  }

  // TSL: sample height at world xz (node vec2). Returns -1000 outside / nothing, fallback 0 outside the capture.
  sample(xz) {
    const uvn = xz.sub(this.origin).mul(this.invSize).add(0.5);
    const inside = uvn.x.greaterThan(0.001).and(uvn.x.lessThan(0.999)).and(uvn.y.greaterThan(0.001)).and(uvn.y.lessThan(0.999));
    // ortho cam looks down -Y with up = -Z  =>  screen +x = world +x, screen +y(v up) = world -z
    const t = texture(this.rt.texture, vec2(uvn.x, uvn.y.oneMinus())).level(0).x;
    return select(inside, t, float(0));
  }

  update(force = false) {
    const { renderer, scene, camera } = this.ctx;
    this.framesSince++;
    const s = this.snap;
    const cp = (this._cp ||= new THREE.Vector3()).setFromMatrixPosition(camera.matrixWorld);
    const cx = Math.round(cp.x / s) * s, cz = Math.round(cp.z / s) * s;
    if (!force && cx === this.center.x && cz === this.center.y && this.framesSince < 90) return false;
    this.center.set(cx, cz);
    this.framesSince = 0;
    const camY = cp.y + this.above;
    this.cam.position.set(cx, camY, cz);
    this.cam.lookAt(cx, camY - 1, cz);
    this.cam.updateMatrixWorld();

    const prevBg = scene.background, prevBgNode = scene.backgroundNode;
    const prevOverride = scene.overrideMaterial;
    const prevTarget = renderer.getRenderTarget();
    const prevMRT = renderer.getMRT();
    const prevClear = renderer.getClearColor(new THREE.Color());
    const prevAlpha = renderer.getClearAlpha();
    for (const o of this.hideList) o.visible = false;
    try {
      scene.background = null; scene.backgroundNode = null;
      scene.overrideMaterial = this.mat;
      renderer.setMRT(null);
      renderer.setRenderTarget(this.rt);
      renderer.setClearColor(this.clearColor, 1);
      renderer.clear();
      renderer.render(scene, this.cam);
    } finally {
      scene.background = prevBg; scene.backgroundNode = prevBgNode;
      scene.overrideMaterial = prevOverride;
      renderer.setRenderTarget(prevTarget);
      renderer.setMRT(prevMRT);
      renderer.setClearColor(prevClear, prevAlpha);
      for (const o of this.hideList) o.visible = true;
    }
    this.origin.value.set(cx, cz);
    return true;
  }
}
