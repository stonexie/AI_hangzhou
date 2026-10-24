// Ground workstream: all walkable ground surfaces (roads, sidewalks, curbs, gutters, alley, promenade, base),
// wet materials (src/materials/wet.js), ground litter/petal decals, Rapier colliders, ctx.api.ground.
import * as THREE from 'three/webgpu';
import { G, heightAt, sidewalkPolys } from './plan.js';
import { buildGroundGeometry } from './geometry.js';
import { buildMarkingAtlas } from './markings.js';
import { roadMaterial } from './roadMaterial.js';
import { sidewalkMaterial, curbMaterial, promenadeMaterial, alleyMaterial, wallMaterial } from './surfaces.js';
import { buildDecals } from './decals.js';
import { updateWetUniforms } from '../../materials/wet.js';
import { vec3 } from 'three/tsl';

const TEX = 'textures/ground/';

async function loadTextures(ctx) {
  const names = ['asphalt_a', 'asphalt_b', 'concrete', 'granite', 'alley_pavers', 'paint_wear', 'sidewalk_tiles', 'stone_pavers', 'tactile_dots', 'tactile_paving', 'manhole', 'drain_grate'];
  const fallback = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1); fallback.needsUpdate = true;
  const out = {};
  await Promise.all(names.map(async (n) => {
    const [c, nm] = await Promise.all([
      ctx.assets.texture(`${TEX}${n}_c.png`, { srgb: true }),
      ctx.assets.texture(`${TEX}${n}_n.png`, { srgb: false }),
    ]);
    out[n] = { c: c || fallback, n: nm || fallback };
  }));
  return {
    asphaltA: out.asphalt_a, asphaltB: out.asphalt_b, concrete: out.concrete, granite: out.granite, alley: out.alley_pavers,
    paintWear: out.paint_wear, sidewalk: out.sidewalk_tiles, stone: out.stone_pavers, tactDots: out.tactile_dots,
    tactLine: out.tactile_paving, manhole: out.manhole, grate: out.drain_grate,
  };
}

function addColliders(ctx, geo) {
  const { RAPIER, world } = ctx.physics || {};
  if (!world) return;
  const box = (x0, x1, y0, y1, z0, z1) => {
    world.createCollider(RAPIER.ColliderDesc.cuboid((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
      .setTranslation((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2).setFriction(0.9));
  };
  // base ground (road level) slabs
  for (const r of geo.baseRects) box(r.x0, r.x1, -1, 0, r.z0, r.z1);
  box(geo.prom.x0, geo.prom.x1, -1, G.prom.y, geo.prom.z0, geo.prom.z1);
  box(geo.alleyLower.x0, geo.alleyLower.x1, -1, 0, geo.alleyLower.z0, geo.alleyLower.z1);
  box(geo.alleyUpper.x0, geo.alleyUpper.x1, G.alley.stairs.rise - 1, G.alley.stairs.rise, geo.alleyUpper.z0, geo.alleyUpper.z1);
  // sidewalks: decompose each C polygon into the avenue strip + arms (axis aligned boxes)
  for (const poly of sidewalkPolys()) {
    const xs = poly.pts.map((p) => p[0]), zs = poly.pts.map((p) => p[1]);
    const side = poly.side;
    const xr = side * G.avHalf, xi = side * (G.avHalf + G.avSide);
    const zHi = Math.max(...zs), zLo = Math.min(...zs);
    box(Math.min(xr, xi), Math.max(xr, xi), -0.2, G.curbH, zLo, zHi);
    const xEnd = side > 0 ? Math.max(...xs) : Math.min(...xs);
    // arms: any points at xEnd define z ranges
    const armZ = poly.pts.filter((p) => p[0] === xEnd).map((p) => p[1]).sort((a, b) => a - b);
    for (let i = 0; i + 1 < armZ.length; i += 2) box(Math.min(xi, xEnd), Math.max(xi, xEnd), -0.2, G.curbH, armZ[i], armZ[i + 1]);
  }
}

function debugNeon(ctx) {
  // Stand-in emitters ONLY when signage is not loaded (isolated ground testing): gives the wet ground
  // something to reflect. Never active in the full game.
  const { scene } = ctx;
  const grp = new THREE.Group(); grp.name = 'ground.debugNeon';
  const cols = [0xff2a6d, 0x05d9e8, 0xffb000, 0xd300c5, 0x00ff9f, 0xff6a00];
  let s = 1;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const side = i % 2 ? 1 : -1;
    const z = 25 - i * 9 - rnd() * 4;
    const c = new THREE.Color(cols[Math.floor(rnd() * cols.length)]);
    const h = 2.6 + rnd() * 6;
    const w = 0.25 + rnd() * 1.5, hh = 0.6 + rnd() * 2.8;
    const mat = new THREE.MeshBasicNodeMaterial({ color: c.clone().multiplyScalar(6) });
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.1, hh, w), mat);
    m.position.set(side * 10.3, h, z);
    grp.add(m);
    const L = new THREE.PointLight(c, 18, 16, 2); L.position.set(side * 9.6, h, z); grp.add(L);
  }
  // facade blocks to occlude the sky
  const fm = new THREE.MeshStandardNodeMaterial({ color: 0x15151a, roughness: 0.8 });
  for (const side of [1, -1]) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(2, 30, 480), fm); b.position.set(side * 11.6, 15, -180); grp.add(b);
  }
  // street lamps
  for (let z = 20; z > -300; z -= 24) {
    for (const side of [1, -1]) {
      const L = new THREE.PointLight(0xffd2a0, 30, 22, 2); L.position.set(side * 6.6, 6.5, z + (side > 0 ? 12 : 0)); grp.add(L);
      const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.8), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xffd2a0).multiplyScalar(8) }));
      bulb.position.copy(L.position); grp.add(bulb);
    }
  }
  scene.add(grp);
  return grp;
}

export default {
  async init(ctx) {
    const { scene } = ctx;
    const T = await loadTextures(ctx);
    const atlas = buildMarkingAtlas();
    const geo = buildGroundGeometry();

    const mats = {
      road: roadMaterial(T, atlas),
      sidewalk: sidewalkMaterial(T),
      curb: curbMaterial(T),
      promenade: promenadeMaterial(T),
      alley: alleyMaterial(T),
      wall: wallMaterial(T),
    };
    const dbg = new URLSearchParams(location.search).get('gdebug');
    if (dbg && mats.road.userData.debug?.[dbg]) { const n = mats.road.userData.debug[dbg]; mats.road.emissiveNode = vec3(n); mats.road.colorNode = vec3(0); }
    const group = new THREE.Group(); group.name = 'ground';
    const add = (g, m, name) => {
      const mesh = new THREE.Mesh(g, m); mesh.name = name; mesh.receiveShadow = true; mesh.castShadow = false;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix(); group.add(mesh); return mesh;
    };
    add(geo.base, mats.road, 'ground.road');
    add(geo.sidewalk, mats.sidewalk, 'ground.sidewalk');
    add(geo.curb, mats.curb, 'ground.curb');
    add(geo.alley, mats.alley, 'ground.alley');
    add(geo.promenade, mats.promenade, 'ground.promenade');
    add(geo.wall, mats.wall, 'ground.wall');
    scene.add(group);

    try { group.add(await buildDecals(ctx, T)); } catch (e) { console.error('[ground] decals failed', e); }

    addColliders(ctx, geo);
    ctx.api.ground = { heightAt, group, materials: mats };
    this._group = group;
    this._debugChecked = false;
  },

  update(dt, t, ctx) {
    updateWetUniforms(ctx.weather);
    if (!this._debugChecked) {
      this._debugChecked = true;
      const names = (ctx.engine?.systems || []).map((s) => s.name);
      if (!names.includes('signage') && !names.includes('buildings')) this._debug = debugNeon(ctx);
    }
  },
};
