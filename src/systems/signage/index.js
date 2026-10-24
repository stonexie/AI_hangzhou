// Signage system: neon/light-box signs on facades, lanterns, holo/video billboards, street furniture lighting.
// Owned by the "signage" workstream. See AGENTS.md for contracts.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './util.js';
import { getFacades } from './facades.js';
import { buildLibrary } from './library.js';
import { Batch } from './batch.js';
import { makeFaceMaterial, makeHousingMaterial, uTime, uWind } from './materials.js';
import { LightPool } from './lights.js';
import { SignBuilder } from './signs.js';
import { populateFacades } from './populate.js';
import { buildLanterns } from './lanterns.js';
import { buildBillboards } from './billboards.js';
import { buildStreet } from './street.js';
import { buildFeatured } from './featured.js';

const state = {};

export default {
  async init(ctx) {
    const { scene, assets } = ctx;
    const t0 = performance.now();
    const img = async (p) => (await assets.texture(p, { srgb: true }))?.image || null;
    const [lightbox, posters, ads] = await Promise.all([
      img('textures/signage/lightbox_atlas.png'), img('textures/signage/posters_atlas.png'), img('textures/signage/ads_grid.png'),
    ]);
    const { L, neonTex, colorTex, NA, CA } = await buildLibrary({ lightbox, posters, ads });
    window.__signageAtlas = { neon: NA.canvas, color: CA.canvas }; // debug: dumped by shots/signage/tmp/dump.mjs
    state.lib = L;

    const faces = new Batch({ tint: 3, sp: 4, back: 3, luv: 4 });
    const housing = new Batch({ col: 3, mr: 2 });
    const pool = new LightPool(scene, ctx.quality === 'low' ? 96 : 190);
    state.pool = pool;
    const rnd = mulberry32(20771);
    const sb = new SignBuilder(L, faces, housing, pool, rnd);

    const facades = getFacades(ctx);
    state.facades = facades;
    sb.facades = facades;
    sb.colorTex = colorTex;
    // hand-placed hero signage first (ramen shop, karaoke, overlook NEON, alley set dressing)
    const featured = await buildFeatured(ctx, sb, facades, L);
    populateFacades(sb, facades.filter((f) => !featured.reserved.has(f)), L, ctx.layout);

    // street furniture + billboards write into the same housing/face batches where possible
    state.street = await buildStreet(ctx, sb, L);
    state.billboards = await buildBillboards(ctx, sb, L, pool, facades);

    const faceMat = makeFaceMaterial(neonTex, colorTex);
    const housingMat = makeHousingMaterial();
    const faceMesh = new THREE.Mesh(faces.build(), faceMat);
    const housingMesh = new THREE.Mesh(housing.build(), housingMat);
    faceMesh.name = 'signage_faces'; housingMesh.name = 'signage_housing';
    for (const m of [faceMesh, housingMesh]) { m.frustumCulled = false; m.matrixAutoUpdate = false; m.updateMatrix(); scene.add(m); }

    state.lanterns = await buildLanterns(ctx, L, colorTex, pool, featured);

    ctx.api.signage = { lights: pool, stats: sb.stats };
    console.log(`[signage] ${sb.stats.signs} signs, ${pool.cands.length} light candidates (${pool.size} pooled), faces ${faces.count} verts, housing ${housing.count} verts, ${(performance.now() - t0).toFixed(0)}ms`);
  },

  update(dt, t, ctx) {
    uTime.value = t;
    const w = ctx.weather?.wind;
    uWind.value = w ? Math.min(2, Math.hypot(w.x, w.y)) : 0.6;
    state.pool?.update(ctx.camera, t);
    state.street?.update?.(dt, t, ctx);
    state.billboards?.update?.(dt, t, ctx);
    state.lanterns?.update?.(dt, t, ctx);
  },
};
