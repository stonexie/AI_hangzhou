import * as THREE from 'three/webgpu';
import {
  texture, uv, attribute, positionWorld, positionLocal, vec2, vec3, vec4, float, mix, smoothstep, step, abs, fract, floor,
  max, min, clamp, time, sin, cos, hash, normalWorld, mx_noise_float, normalMap, uniform, normalFlat, positionView, dot, normalize,
} from 'three/tsl';
import { mulberry32, cylinderCol, groundY } from './util.js';
import { U } from './materials.js';

// Cherry blossom trees along the promenade (Blender-generated GLBs, instanced), falling petals, petals on water & ground.
export async function buildTrees(ctx, tex, root) {
  const P = ctx.layout.promenade;
  const R = ctx.layout.river;
  const W = R.waterLevel;
  const variants = await Promise.all([0, 1, 2, 3].map((i) => ctx.assets.gltf(`models/landmarks/cherry_tree_${i}.glb`)));
  const rng = mulberry32(4242);

  // ---- placement ----
  const bridgeZ = ctx.layout.bridges[0].z;
  const rail = ctx.layout.elevatedRail, ex = ctx.layout.expressway;
  const spots = [];
  for (let z = P.zStart - 4; z > P.zEnd + 4; z -= 9 + rng() * 3.5) {
    if (Math.abs(z - bridgeZ) < 16) continue;
    if (Math.abs(z - rail.z) < 6 || Math.abs(z - ex.z) < 4) continue;
    const x = P.xMin + 1.6 + rng() * 1.4;
    spots.push({ x, z, v: Math.floor(rng() * 4), rot: (rng() - 0.5) * 0.7, s: 0.85 + rng() * 0.3 });
  }

  // ---- materials ----
  const bark = new THREE.MeshStandardNodeMaterial();
  {
    const u0 = uv();
    const alb = texture(tex.bark, u0).rgb;
    const n = mx_noise_float(positionWorld.mul(1.3)).mul(0.5).add(0.5);
    const up = clamp(normalWorld.y, 0, 1);
    // dark wet bark, moss on upward-facing limbs
    let c = alb.mul(vec3(0.62, 0.55, 0.52)).mul(mix(0.6, 1.1, n)).mul(mix(float(1), float(0.55), U.wet));
    c = mix(c, vec3(0.05, 0.07, 0.03), up.mul(0.35).mul(smoothstep(0.4, 0.8, n)));
    bark.colorNode = c;
    const r = texture(tex.bark_r, u0).r;
    bark.roughnessNode = clamp(mix(r, r.mul(0.35).add(0.1), U.wet.mul(mix(0.55, 1.0, up))), 0.08, 1);
    bark.metalnessNode = float(0);
    bark.normalNode = normalMap(texture(tex.bark_n, u0), vec2(1.6, 1.6));
  }
  const blossom = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.5, transparent: false });
  {
    const u0 = uv();
    const t = texture(tex.blossom, u0);
    const u1 = attribute('uv1', 'vec2'); // x: random tint, y: outerness 0..1
    const pw = positionWorld;
    // deeper pink to near white variation per card, inner canopy darker (self-shadowing)
    const tint = mix(vec3(1.0, 0.58, 0.74), vec3(1.0, 0.85, 0.9), u1.x);
    const ao = mix(float(0.18), float(1.0), smoothstep(0.2, 0.95, u1.y));
    const base = t.rgb.mul(tint).mul(ao);
    blossom.colorNode = base;
    // fade cards seen edge-on (avoids stretched streaks)
    const facing = abs(dot(normalFlat, normalize(positionView)));
    blossom.opacityNode = t.a.mul(smoothstep(0.08, 0.38, facing).mul(0.6).add(0.4)).add(t.a.mul(0.0));
    blossom.roughnessNode = float(0.55);
    blossom.metalnessNode = float(0);
    // translucency / bounce glow: warm lantern light from below the river side + pink neon city glow
    const lowGlow = smoothstep(9.0, 2.5, pw.y);
    const riverSide = smoothstep(P.xMin, P.xMax + 1, pw.x);
    const lantern = vec3(1.0, 0.55, 0.42).mul(lowGlow.mul(riverSide.mul(0.6).add(0.4))).mul(0.55);
    const city = vec3(0.9, 0.35, 0.65).mul(0.12);
    blossom.emissiveNode = base.mul(lantern.add(city)).mul(ao);
  }

  // ---- instanced trunks + canopies ----
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (let vi = 0; vi < 4; vi++) {
    const g = variants[vi];
    if (!g) continue;
    let trunkGeo = null, blossomGeo = null;
    g.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (o.name.startsWith('trunk') || o.material?.name === 'bark') trunkGeo = o.geometry;
      else blossomGeo = o.geometry;
    });
    const list = spots.filter((sp) => sp.v === vi);
    if (!list.length) continue;
    const mk = (geo, mat, name) => {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((sp, i) => {
        q.setFromAxisAngle(yAxis, sp.rot); p.set(sp.x, groundY(ctx, sp.x, sp.z), sp.z); s.setScalar(sp.s);
        m4.compose(p, q, s); im.setMatrixAt(i, m4);
      });
      im.computeBoundingSphere();
      im.name = name; im.castShadow = false; im.receiveShadow = true;
      root.add(im);
      return im;
    };
    if (trunkGeo) mk(trunkGeo, bark, 'cherry_trunk_' + vi);
    if (blossomGeo) mk(blossomGeo, blossom, 'cherry_blossom_' + vi);
  }
  for (const sp of spots) cylinderCol(ctx, sp.x, 1.5, sp.z, 1.5, 0.35 * sp.s);

  // ---- petals: falling, on water, on ground ----
  if (tex.petals) {
    root.add(fallingPetals(ctx, tex, spots));
    root.add(flatPetals(ctx, tex, 'water', spots));
    // the ground system owns promenade petal decals; only add ours when it is not loaded
    if (!ctx.engine?.systems?.some((x) => x.name === 'ground')) root.add(flatPetals(ctx, tex, 'ground', spots));
  }
  // tree grates (cast iron squares around trunks)
  const grateGeo = new THREE.CylinderGeometry(0.75, 0.75, 0.025, 24);
  const grateMat = new THREE.MeshStandardNodeMaterial();
  {
    const pw = positionWorld;
    const slots = float(0);
    grateMat.colorNode = mix(vec3(0.025, 0.022, 0.02), vec3(0.0), slots);
    grateMat.roughnessNode = float(0.55);
    grateMat.metalnessNode = float(0.2);
  }
  const grates = new THREE.InstancedMesh(grateGeo, grateMat, spots.length);
  spots.forEach((sp, i) => { m4.compose(p.set(sp.x, groundY(ctx, sp.x, sp.z) + 0.015, sp.z), q.identity(), s.setScalar(1)); grates.setMatrixAt(i, m4); });
  grates.computeBoundingSphere();
  root.add(grates);
  return { spots };
}

function petalMaterial(tex, kind) {
  const m = new THREE.MeshStandardNodeMaterial({ side: THREE.DoubleSide, alphaTest: 0.4 });
  const cell = attribute('aCell', 'float');
  const u0 = uv();
  const cu = vec2(fract(cell.div(4)), floor(cell.div(4)).div(4));
  const t = texture(tex.petals, u0.mul(0.25).add(vec2(cu.x, float(0.75).sub(cu.y))));
  const base = t.rgb.mul(vec3(1.0, 0.86, 0.9));
  m.colorNode = kind === 'ground' ? base.mul(0.75) : base;
  m.opacityNode = t.a;
  m.roughnessNode = float(kind === 'falling' ? 0.5 : 0.25);
  m.metalnessNode = float(0);
  m.emissiveNode = base.mul(vec3(0.9, 0.45, 0.45)).mul(kind === 'falling' ? 0.35 : 0.08);
  return m;
}

// Merged quads; each petal's 4 verts share aBase (x,y,z,seed); vertex shader animates the fall.
function fallingPetals(ctx, tex, spots) {
  const N = 5000;
  const rng = mulberry32(99);
  const pos = new Float32Array(N * 4 * 3), base = new Float32Array(N * 4 * 4), cellA = new Float32Array(N * 4), uvs = new Float32Array(N * 8);
  const idx = new Uint32Array(N * 6);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (let i = 0; i < N; i++) {
    const sp = spots[Math.floor(rng() * spots.length)];
    const bx = sp.x + (rng() - 0.3) * 12, bz = sp.z + (rng() - 0.5) * 12, by = rng() * 9, seed = rng();
    const c = Math.floor(rng() * 16);
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      pos.set([corners[k][0] * 0.022, corners[k][1] * 0.022, 0], vi * 3);
      base.set([bx, by, bz, seed], vi * 4);
      cellA[vi] = c;
      uvs.set([(corners[k][0] + 1) / 2, (corners[k][1] + 1) / 2], vi * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 4));
  g.setAttribute('aCell', new THREE.BufferAttribute(cellA, 1));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(134, 5, -230), 320);
  const m = petalMaterial(tex, 'falling');
  const b = attribute('aBase', 'vec4');
  const sd = b.w;
  const H = 9.0;
  const tt = time.add(sd.mul(100));
  const fallY = fract(b.y.div(H).sub(time.mul(mix(0.06, 0.11, sd)))).mul(H).add(0.02);
  const drift = vec3(sin(tt.mul(0.9)).mul(0.6).add(time.mul(0.35).mul(mix(0.5, 1.0, sd))), 0, cos(tt.mul(0.7)).mul(0.5).sub(time.mul(0.12)));
  // wrap horizontal drift in a 14m cell so petals stay near trees
  const wx = fract(drift.x.div(14)).mul(14).sub(7);
  const wz = fract(drift.z.div(14)).mul(14).sub(7);
  const ang = tt.mul(mix(2.0, 5.0, sd));
  const lp = positionLocal;
  const ca = cos(ang), sa = sin(ang);
  const rot = vec3(lp.x.mul(ca), lp.y, lp.x.mul(sa).add(lp.y.mul(cos(ang.mul(0.7)).mul(0.6))));
  m.positionNode = vec3(b.x.add(wx), fallY, b.z.add(wz)).add(rot);
  const mesh = new THREE.Mesh(g, m);
  mesh.name = 'falling_petals';
  return mesh;
}

function flatPetals(ctx, tex, kind, spots) {
  const R = ctx.layout.river, P = ctx.layout.promenade;
  const N = kind === 'water' ? 9000 : 14000;
  const rng = mulberry32(kind === 'water' ? 5 : 6);
  const pos = new Float32Array(N * 4 * 3), cellA = new Float32Array(N * 4), uvs = new Float32Array(N * 8), base = new Float32Array(N * 4 * 4);
  const idx = new Uint32Array(N * 6);
  const xw = R.xCenter - R.halfWidth;
  for (let i = 0; i < N; i++) {
    let x, z, y;
    if (kind === 'water') {
      // drifting rafts: clustered near the west bank, thinning toward mid-river
      x = xw + 0.5 + Math.pow(rng(), 2.2) * 30;
      z = P.zStart - rng() * (P.zStart - P.zEnd);
      if (rng() < 0.5) { const c = spots[Math.floor(rng() * spots.length)]; z = c.z + (rng() - 0.5) * 16; x = xw + 0.4 + Math.pow(rng(), 3) * 10; }
      y = R.waterLevel + 0.012;
    } else {
      const c = spots[Math.floor(rng() * spots.length)];
      const r = Math.pow(rng(), 0.7) * 7;
      const a = rng() * Math.PI * 2;
      x = Math.min(P.xMax - 0.5, Math.max(P.xMin + 0.2, c.x + 2 + Math.cos(a) * r));
      z = c.z + Math.sin(a) * r;
      y = groundY(ctx, x, z) + 0.008 + rng() * 0.004;
    }
    const s = 0.018 + rng() * 0.012, a = rng() * Math.PI * 2;
    const c = Math.floor(rng() * 16);
    const cs = Math.cos(a), sn = Math.sin(a);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
    for (let k = 0; k < 4; k++) {
      const vi = i * 4 + k;
      const lx = corners[k][0] * s, lz = corners[k][1] * s;
      pos.set([x + lx * cs - lz * sn, y, z + lx * sn + lz * cs], vi * 3);
      base.set([x, y, z, rng()], vi * 4);
      cellA[vi] = c;
      uvs.set([(corners[k][0] + 1) / 2, (corners[k][1] + 1) / 2], vi * 2);
    }
    idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3], i * 6);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aCell', new THREE.BufferAttribute(cellA, 1));
  g.setAttribute('aBase', new THREE.BufferAttribute(base, 4));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const m = petalMaterial(tex, kind);
  if (kind === 'water') {
    // slow downstream drift (wrap within a 40m window) + bobbing
    const b = attribute('aBase', 'vec4');
    const lp = positionLocal;
    m.positionNode = vec3(lp.x, lp.y.add(sin(time.mul(1.3).add(b.w.mul(30))).mul(0.006)), lp.z.add(sin(time.mul(0.08).add(b.w.mul(6.28))).mul(0.9)));
  }
  const mesh = new THREE.Mesh(g, m);
  mesh.name = kind + '_petals';
  return mesh;
}
