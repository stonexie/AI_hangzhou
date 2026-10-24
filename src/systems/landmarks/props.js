import * as THREE from 'three/webgpu';
import { positionWorld, vec3, float, mix, mx_noise_float, clamp, normalWorld, texture, uv, vec2, normalMap } from 'three/tsl';
import { Batch, beamBetween, cuboid, groundY, mulberry32 } from './util.js';
import { surface, metal, emissiveMat, U } from './materials.js';

// Promenade furniture: benches, planters with shrubs, parked bicycles, info signs / bollards.
export function buildProps(ctx, tex, root, treeSpots) {
  const P = ctx.layout.promenade;
  const bridgeZ = ctx.layout.bridges[0].z;
  const rng = mulberry32(3131);
  const b = new Batch();
  const occupied = treeSpots.map((t) => t.z);
  const free = (z, r) => occupied.every((oz) => Math.abs(oz - z) > r) && Math.abs(z - bridgeZ) > 20;

  // ---- benches: between trees, facing the river ----
  const bench = (x, z, ry) => {
    const y = groundY(ctx, x, z);
    const c = Math.cos(ry), s = Math.sin(ry);
    const L = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    // seat slats (along local z = bench length)
    for (let i = 0; i < 4; i++) { const [px, pz] = L(-0.22 + i * 0.13, 0); b.box('wood', 0.11, 0.04, 1.8, px, y + 0.45, pz, ry); }
    // backrest slats
    for (let i = 0; i < 3; i++) { const [px, pz] = L(-0.32 - i * 0.025, 0); b.box('wood', 0.03, 0.1, 1.8, px, y + 0.6 + i * 0.13, pz, ry, 0, -0.18); }
    for (const lz of [-0.75, 0.75]) {
      const [px, pz] = L(0, lz);
      b.box('iron', 0.55, 0.06, 0.06, px, y + 0.42, pz, ry);
      const [ax, az] = L(0.2, lz), [bx, bz] = L(-0.25, lz);
      b.box('iron', 0.06, 0.44, 0.06, ax, y + 0.22, az, ry);
      b.box('iron', 0.06, 0.9, 0.06, bx, y + 0.45, bz, ry, 0, -0.18);
      const [rx, rz] = L(0.05, lz * 1.07); b.box('iron', 0.5, 0.05, 0.05, rx, y + 0.65, rz, ry);
    }
    cuboid(ctx, x, y + 0.4, z, 0.35, 0.4, 0.9, ry);
  };
  // ---- planter: stone box + shrub mass + small spotlight ----
  const shrubGeo = new THREE.IcosahedronGeometry(1, 3);
  {
    const p = shrubGeo.attributes.position;
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      const n = Math.sin(v.x * 7.1) * Math.cos(v.y * 6.3) * Math.sin(v.z * 8.7) * 0.18 + Math.sin(v.x * 17 + v.z * 13) * 0.06;
      v.multiplyScalar(1 + n); p.setXYZ(i, v.x, v.y, v.z);
    }
    shrubGeo.computeVertexNormals();
  }
  const planter = (x, z, len) => {
    const y = groundY(ctx, x, z);
    b.box('stone', 1.2, 0.6, len, x, y + 0.3, z);
    b.box('coping', 1.3, 0.08, len + 0.1, x, y + 0.62, z);
    for (let k = 0; k < Math.round(len / 0.7); k++) {
      const sz = 0.38 + rng() * 0.2;
      b.add('shrub', shrubGeo, x + (rng() - 0.5) * 0.3, y + 0.62 + sz * 0.6, z - len / 2 + 0.35 + k * 0.7, 0, rng() * 6, 0, sz * 1.2, sz, sz * 1.2);
    }
    cuboid(ctx, x, y + 0.35, z, 0.6, 0.35, len / 2);
  };
  // ---- bicycle (city "mamachari" with basket) ----
  const torus = new THREE.TorusGeometry(0.33, 0.022, 6, 28);
  const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.1, 8);
  const bike = (x, z, ry, tilt) => {
    const y = groundY(ctx, x, z);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, ry, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    const sub = new Batch();
    for (const wx of [-0.52, 0.52]) {
      sub.add('tire', torus, wx, 0.35, 0);
      sub.add('chrome', hub, wx, 0.35, 0, Math.PI / 2, 0, 0);
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 8; beamBetween(sub, 'chrome', new THREE.Vector3(wx - Math.cos(a) * 0.31, 0.35 - Math.sin(a) * 0.31, 0), new THREE.Vector3(wx + Math.cos(a) * 0.31, 0.35 + Math.sin(a) * 0.31, 0), 0.006, 0.006); }
    }
    const V = (a, bb, c) => new THREE.Vector3(a, bb, c);
    const frame = [[V(-0.52, 0.35, 0), V(-0.1, 0.38, 0)], [V(-0.1, 0.38, 0), V(-0.2, 0.85, 0)], [V(-0.1, 0.38, 0), V(0.42, 0.78, 0)],
      [V(0.42, 0.78, 0), V(0.52, 0.35, 0)], [V(-0.52, 0.35, 0), V(-0.2, 0.8, 0)], [V(0.42, 0.78, 0), V(0.38, 1.0, 0)]];
    for (const [a, c] of frame) beamBetween(sub, 'frame', a, c, 0.035, 0.035);
    sub.box('tire', 0.24, 0.05, 0.12, -0.22, 0.9, 0); // saddle
    sub.box('chrome', 0.03, 0.03, 0.55, 0.36, 1.02, 0); // handlebar
    sub.box('basket', 0.3, 0.22, 0.36, 0.6, 0.92, 0); // front basket
    sub.box('frame', 0.55, 0.02, 0.12, -0.55, 0.72, 0); // rear rack / fender
    for (const [key, list] of sub.parts) for (const g of list) b.addMatrix(key, g, m);
  };

  // layout along promenade
  let k = 0;
  for (let z = P.zStart - 8; z > P.zEnd + 8; z -= 7) {
    if (!free(z, 2.4)) continue;
    k++;
    const r = rng();
    if (k % 3 === 0 && r < 0.85) bench(P.xMin + 2.6, z, Math.PI / 2 * 0 + 0);
    else if (k % 5 === 1) planter(P.xMin + 0.8, z, 3.2);
    else if (k % 7 === 2) { bike(P.xMin + 3.4, z, Math.PI / 2 + (rng() - 0.5) * 0.4, -0.12); bike(P.xMin + 3.4, z - 0.7, Math.PI / 2 + (rng() - 0.5) * 0.4, 0.1); }
  }
  // a couple of bicycles leaning near the railing in the river view
  bike(P.xMax - 0.9, -32, 0.08, 0.16);
  bike(P.xMax - 0.9, -78, -0.05, 0.16);

  const wood = surface({ map: tex.wood, nmap: tex.wood_slats_n, rmap: tex.wood_slats_r }, { uvScale: 1 / 1.2, tint: [0.75, 0.6, 0.5], streaks: false, detail: false, wetRough: 0.1 });
  const shrub = new THREE.MeshStandardNodeMaterial();
  {
    const n = mx_noise_float(positionWorld.mul(9)).mul(0.5).add(0.5);
    const n2 = mx_noise_float(positionWorld.mul(2.1)).mul(0.5).add(0.5);
    shrub.colorNode = mix(vec3(0.015, 0.035, 0.012), vec3(0.05, 0.09, 0.03), n).mul(mix(0.6, 1.2, n2));
    shrub.roughnessNode = mix(float(0.7), float(0.25), U.wet.mul(n));
    shrub.metalnessNode = float(0);
  }
  const mats = {
    wood, shrub,
    iron: metal({ color: [0.05, 0.05, 0.055], rough: 0.45, metal: 0.8 }),
    stone: surface({ map: tex.concrete, nmap: tex.concrete_n, rmap: tex.concrete_r }, { uvScale: 1 / 1.5, tint: [0.6, 0.58, 0.55] }),
    coping: surface({ map: tex.stonewall, nmap: tex.stonewall_n, rmap: tex.stonewall_r }, { uvScale: 1 / 1.2, tint: [0.5, 0.5, 0.5], streaks: false }),
    tire: metal({ color: [0.02, 0.02, 0.02], rough: 0.5, metal: 0 }),
    chrome: metal({ color: [0.7, 0.7, 0.72], rough: 0.15, metal: 1 }),
    frame: metal({ color: [0.45, 0.05, 0.06], rough: 0.3, metal: 0.3 }),
    basket: metal({ color: [0.3, 0.3, 0.32], rough: 0.35, metal: 0.9 }),
  };
  const g = b.build(mats, { worldUV: { wood: 1, stone: 1, coping: 1 }, chunk: 60 });
  g.name = 'promenade_props';
  root.add(g);
}
