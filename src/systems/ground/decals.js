// Ground decals: litter (cigarette butts, wet newspaper, flyers, leaves, receipts, bags, cardboard...) and fallen
// cherry petals on the promenade. Two InstancedMeshes (2 draw calls), alpha-tested atlases, wet shading.
import * as THREE from 'three/webgpu';
import { float, vec2, vec3, texture, attribute, uv, positionWorld, mix, clamp } from 'three/tsl';
import { wetLayer, rainRipples, upNormalToView } from '../../materials/wet.js';
import { G, heightAt, curbDist } from './plan.js';

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// litter atlas cells (4x4, row 0 = top of image): size = world size of the full cell (m)
const LITTER = {
  butts: { cell: 0, size: 0.17 }, news: { cell: 1, size: 0.55 }, cup: { cell: 2, size: 0.15 },
  leaves: { cell: 4, size: 0.3 }, receipt: { cell: 6, size: 0.17 }, bag: { cell: 7, size: 0.42 },
  card: { cell: 8, size: 0.55 }, caps: { cell: 9, size: 0.075 }, straw: { cell: 10, size: 0.22 },
  wrap: { cell: 11, size: 0.24 }, flyer: { cell: 12, size: 0.3 }, leaf: { cell: 14, size: 0.13 }, tissue: { cell: 15, size: 0.15 },
};

function decalMaterial(texA, texN, { petals = false } = {}) {
  const m = new THREE.MeshStandardNodeMaterial({ name: petals ? 'ground.petals' : 'ground.litter', alphaTest: 0.5, side: THREE.DoubleSide });
  m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -4;
  const cell = attribute('aCell', 'vec2');
  const auv = uv().add(cell).div(4);
  const c = texture(texA, auv);
  const n = texture(texN, auv);
  const P = positionWorld.xz;
  const tint = attribute('aTint', 'float');
  const albedo = c.rgb.mul(petals ? mix(0.8, 1.1, tint) : mix(0.7, 1.0, tint));
  const L = wetLayer({ albedo, roughness: float(petals ? 0.5 : 0.7), nxy: n.rg.mul(2).sub(1).mul(petals ? 0.3 : 0.8), porosity: petals ? 0.2 : 0.45, puddle: float(0), ripple: rainRipples(P), filmRipple: 0.1 });
  m.colorNode = L.albedo;
  m.opacityNode = c.a;
  m.roughnessNode = clamp(L.roughness, 0.05, 1);
  m.metalnessNode = float(0);
  m.normalNode = upNormalToView(L.nxy);
  return m;
}

function makeInstanced(items, mat) {
  const g = new THREE.PlaneGeometry(1, 1); g.rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(g, mat, items.length);
  const cells = new Float32Array(items.length * 2), tints = new Float32Array(items.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const e = new THREE.Euler();
  items.forEach((it, i) => {
    e.set(it.tilt || 0, it.rot, 0, 'YXZ'); q.setFromEuler(e);
    s.set(it.size * (it.sx || 1), 1, it.size);
    p.set(it.x, it.y, it.z);
    m4.compose(p, q, s);
    mesh.setMatrixAt(i, m4);
    cells[i * 2] = it.cell % 4; cells[i * 2 + 1] = 3 - Math.floor(it.cell / 4);
    tints[i] = it.tint;
  });
  g.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(tints, 1));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.frustumCulled = false;
  mesh.receiveShadow = true;
  return mesh;
}

export async function buildDecals(ctx, T) {
  const grp = new THREE.Group(); grp.name = 'ground.decals';
  const [lA, lN, pA, pN] = await Promise.all([
    ctx.assets.texture('textures/ground/litter_atlas_a.png', { srgb: true }),
    ctx.assets.texture('textures/ground/litter_atlas_n.png', { srgb: false }),
    ctx.assets.texture('textures/ground/petals_atlas_a.png', { srgb: true }),
    ctx.assets.texture('textures/ground/petals_atlas_n.png', { srgb: false }),
  ]);
  const rnd = mulberry32(0x6A0D);
  const pick = (table) => { let t = 0; for (const [, w] of table) t += w; let r = rnd() * t; for (const [k, w] of table) { r -= w; if (r <= 0) return k; } return table[0][0]; };
  const items = [];
  let k = 0;
  const put = (type, x, z, extra = {}) => {
    const L = LITTER[type];
    const sc = L.size * (0.8 + rnd() * 0.45);
    items.push({ x, z, y: heightAt(x, z) + 0.004 + (k++ % 7) * 0.0006, rot: rnd() * Math.PI * 2, size: sc, cell: L.cell, tint: rnd(), ...extra });
  };
  const gutterMix = [['butts', 5], ['leaf', 4], ['leaves', 2], ['receipt', 2], ['caps', 2], ['tissue', 2], ['wrap', 1.5], ['straw', 1], ['cup', 1], ['news', 0.7], ['flyer', 0.8]];
  const walkMix = [['butts', 6], ['leaf', 3], ['receipt', 1.5], ['flyer', 1.2], ['tissue', 1], ['caps', 1], ['news', 0.4], ['straw', 0.6]];
  const alleyMix = [['butts', 5], ['card', 1.5], ['news', 1.5], ['bag', 1], ['leaves', 2], ['leaf', 2], ['tissue', 1.5], ['cup', 1], ['receipt', 1], ['flyer', 1], ['wrap', 1]];

  // gutters along the avenue (both sides) and cross streets
  for (let i = 0; i < 2400; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const z = G.zS - rnd() * (G.zS - G.zN);
    const off = Math.pow(rnd(), 1.8) * 0.9 + 0.04;
    const x = side * (G.avHalf - off);
    if (curbDist(x, z) < 0.02) continue;
    put(pick(gutterMix), x, z);
  }
  for (const zc of G.crossZ) {
    for (let i = 0; i < 500; i++) {
      const side = rnd() < 0.5 ? -1 : 1;
      const x = G.xW + rnd() * (G.xE - G.xW);
      const z = zc + side * (G.crHalf - (Math.pow(rnd(), 1.8) * 0.9 + 0.04));
      if (curbDist(x, z) < 0.02) continue;
      put(pick(gutterMix), x, z);
    }
  }
  // sidewalks (mostly near building fronts / curb edge)
  for (let i = 0; i < 1800; i++) {
    const side = rnd() < 0.5 ? -1 : 1;
    const z = G.zS - rnd() * (G.zS - G.zN);
    const t = rnd();
    const x = side * (t < 0.6 ? G.avHalf + G.avSide - 0.65 - Math.pow(rnd(), 2) * 1.2 : G.avHalf + 0.3 + rnd() * (G.avSide - 1));
    put(pick(walkMix), x, z);
  }
  // road surface: sparse flattened paper / leaves
  for (let i = 0; i < 500; i++) {
    const z = G.zS - rnd() * (G.zS - G.zN);
    const x = (rnd() * 2 - 1) * (G.avHalf - 0.3);
    put(pick([['leaf', 3], ['receipt', 1], ['news', 0.5], ['flyer', 0.5], ['butts', 1]]), x, z);
  }
  // alley: dense
  const al = G.alley;
  for (let i = 0; i < 1400; i++) {
    const x = al.x1 - rnd() * (al.x1 - al.x0);
    if (x < al.stairs.xStart && x > al.stairs.xEnd) continue;
    const edge = rnd() < 0.7;
    const zz = edge ? (rnd() < 0.5 ? -1 : 1) * (al.half - 0.08 - Math.pow(rnd(), 2) * 0.9) : (rnd() * 2 - 1) * (al.half - 0.2);
    put(pick(alleyMix), x, al.z + zz);
  }
  grp.add(makeInstanced(items, decalMaterial(lA, lN)));

  // cherry petals on the promenade: drifts (clusters) + scatter, more toward the river edge
  const petals = [];
  const pr = G.prom;
  const clusters = [];
  for (let i = 0; i < 420; i++) clusters.push([pr.x0 + 1 + rnd() * (pr.x1 - pr.x0 - 1.5), pr.z1 - rnd() * (pr.z1 - pr.z0), 0.4 + rnd() * 1.8]);
  for (let i = 0; i < 52000; i++) {
    let x, z;
    if (rnd() < 0.72) {
      const c = clusters[Math.floor(rnd() * clusters.length)];
      const a = rnd() * Math.PI * 2, r = Math.sqrt(-2 * Math.log(rnd() + 1e-6)) * c[2] * 0.5;
      x = c[0] + Math.cos(a) * r; z = c[1] + Math.sin(a) * r * 1.6;
    } else {
      x = pr.x0 + Math.pow(rnd(), 0.6) * (pr.x1 - pr.x0); z = pr.z1 - rnd() * (pr.z1 - pr.z0);
    }
    if (x < pr.x0 + 0.05 || x > pr.x1 - 0.05) continue;
    const cell = Math.floor(rnd() * 16);
    petals.push({ x, z, y: pr.y + 0.003 + (i % 5) * 0.0005, rot: rnd() * Math.PI * 2, size: 0.045 + rnd() * 0.035, cell, tint: rnd() });
  }
  grp.add(makeInstanced(petals, decalMaterial(pA, pN, { petals: true })));
  return grp;
}
