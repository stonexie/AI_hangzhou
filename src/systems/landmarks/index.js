// Landmarks workstream: elevated rail + trains, expressway, river + embankments + promenade furniture,
// cherry blossom trees + petals, bridge, distant skyline megatowers with holo ads.
import * as THREE from 'three/webgpu';
import { loadTextures, U } from './materials.js';
import { buildRail } from './rail.js';
import { buildExpressway } from './expressway.js';
import { buildSkyline } from './skyline.js';
import { buildRiver } from './river.js';
import { buildTrees } from './trees.js';
import { buildBridge } from './bridge.js';
import { buildProps } from './props.js';

const optional = async (name, fn) => {
  try { return await fn(); } catch (e) { console.error(`[landmarks] ${name} failed`, e); return null; }
};

export default {
  async init(ctx) {
    const root = new THREE.Group();
    root.name = 'landmarks';
    ctx.scene.add(root);
    this.root = root;
    const tex = await loadTextures(ctx);
    this.tex = tex;
    this.updaters = [];

    // Debug fallback: when the ground system is not loaded (?only=...), add a simple dark floor with a river cut-out
    const hasGround = ctx.engine?.systems?.some((s) => s.name === 'ground');
    if (!hasGround) {
      const R = ctx.layout.river;
      const m = new THREE.MeshStandardNodeMaterial({ color: 0x0c0c0e, roughness: 0.7 });
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2000).rotateX(-Math.PI / 2), m);
      w.position.set(R.xCenter - R.halfWidth - 700, 0, -300); root.add(w);
      const e = new THREE.Mesh(new THREE.PlaneGeometry(1400, 2000).rotateX(-Math.PI / 2), m);
      e.position.set(R.xCenter + R.halfWidth + 700, 0, -300); root.add(e);
    }

    const api = {};
    const rail = await optional('rail', () => buildRail(ctx, tex, root));
    if (rail) { api.rail = rail.api; this.updaters.push(rail.update); }
    const ex = await optional('expressway', () => buildExpressway(ctx, tex, root));
    if (ex) api.expressway = ex.api;
    const river = await optional('river', () => buildRiver(ctx, tex, root));
    if (river) api.river = river.api;
    const trees = await optional('trees', () => buildTrees(ctx, tex, root));
    await optional('props', () => buildProps(ctx, tex, root, trees?.spots || []));
    const br = await optional('bridge', () => buildBridge(ctx, tex, root));
    if (br) api.bridges = br.api;
    const sky = await optional('skyline', () => buildSkyline(ctx, tex, root));
    if (sky) api.skyline = { towers: sky.towers.map((t) => ({ x: t.x, z: t.z, w: t.w, d: t.d, h: t.h })) };
    ctx.api.landmarks = api;
  },

  update(dt, t, ctx) {
    U.wet.value = ctx.weather?.wetness ?? 1;
    U.lightning.value = ctx.weather?.lightning ?? 0;
    for (const u of this.updaters) u(dt, t, ctx);
  },
};
