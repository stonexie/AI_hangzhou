import * as THREE from 'three/webgpu';
import {
  positionWorld, vec2, vec3, vec4, float, mix, smoothstep, step, abs, fract, floor, max, min, clamp, time, reflector,
  mx_noise_float, normalize, dot, cameraPosition, pow, screenUV, uv, texture, sin, hash,
} from 'three/tsl';
import { rainRipples, upNormalToView } from '../../materials/wet.js';
import { Batch, cuboid, mulberry32 } from './util.js';
import { surface, metal, emissiveMat, U } from './materials.js';

// River: reflective rain-rippled water (planar reflection), stone embankments, promenade railing + lanterns.
export function buildRiver(ctx, tex, root) {
  const R = ctx.layout.river;
  const P = ctx.layout.promenade;
  const W = R.waterLevel;
  const xw = R.xCenter - R.halfWidth, xe = R.xCenter + R.halfWidth; // 140, 210
  const zs = R.zStart, ze = R.zEnd;
  const zMid = (zs + ze) / 2, zLen = zs - ze;

  // ---------------- water ----------------
  const refl = reflector({ resolutionScale: ctx.isShot ? 0.6 : 0.5, bounces: false });
  refl.target.rotateX(-Math.PI / 2);
  refl.target.position.set(R.xCenter, W, zMid);
  root.add(refl.target);

  const pw = positionWorld;
  const flow = time.mul(0.35);
  const fq = pw.xz.mul(vec2(0.45, 0.18)).add(vec2(0, flow));
  const e = 0.6;
  const nA = mx_noise_float(vec3(fq.x, fq.y, time.mul(0.15)));
  const nB = mx_noise_float(vec3(fq.x.add(e), fq.y, time.mul(0.15)));
  const nC = mx_noise_float(vec3(fq.x, fq.y.add(e), time.mul(0.15)));
  const fq2 = pw.xz.mul(vec2(1.7, 0.9)).add(vec2(0, flow.mul(2.3)));
  const mA = mx_noise_float(vec3(fq2.x, fq2.y, 3.3));
  const mB = mx_noise_float(vec3(fq2.x.add(0.3), fq2.y, 3.3));
  const mC = mx_noise_float(vec3(fq2.x, fq2.y.add(0.3), 3.3));
  const flowN = vec2(nB.sub(nA), nC.sub(nA)).mul(0.22).add(vec2(mB.sub(mA), mC.sub(mA)).mul(0.12));
  const rip = rainRipples(pw.xz, { intensity: 2.2, scale: 1.25 });
  const nxy = flowN.add(rip);

  // distorted planar reflection with vertical streak blur (rain-roughened water stretches lights vertically)
  const baseUV = refl.uvNode;
  const dist = nxy.mul(vec2(0.05, 0.035));
  let acc = vec3(0);
  const taps = [[0, 0.32], [-0.012, 0.17], [0.012, 0.17], [-0.024, 0.08], [0.024, 0.08], [-0.04, 0.03], [0.04, 0.03], [0.06, 0.02], [-0.06, 0.02]];
  let wsum = 0;
  for (const [dy, w] of taps) {
    acc = acc.add(refl.sample(baseUV.add(dist).add(vec2(0, dy))).rgb.mul(w));
    wsum += w;
  }
  const reflRaw = acc.div(wsum);
  // rain-roughened water: dim diffuse sky/fog reflection, keep bright light sources crisp
  const rl = dot(reflRaw, vec3(0.2126, 0.7152, 0.0722));
  const reflCol = reflRaw.mul(mix(float(0.3), float(1.0), smoothstep(0.04, 0.5, rl)));

  const V = normalize(cameraPosition.sub(pw));
  const ny = 1.0;
  const nW = normalize(vec3(nxy.x, ny, nxy.y));
  const cosT = clamp(dot(V, nW), 0, 1);
  const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(cosT), 5)));
  const water = new THREE.MeshStandardNodeMaterial();
  // murky dark water body; slight green-teal depth tint near banks
  const bankD = min(pw.x.sub(xw), float(xe).sub(pw.x));
  const deep = vec3(0.004, 0.006, 0.007).mul(mix(1.6, 1.0, smoothstep(0, 8, bankD)));
  water.colorNode = deep;
  water.roughnessNode = float(0.07);
  water.metalnessNode = float(0);
  water.normalNode = upNormalToView(nxy.mul(0.7));
  water.emissiveNode = reflCol.mul(mix(float(0.16), float(0.85), fres));
  const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(xe - xw + 2, zLen, 1, 1).rotateX(-Math.PI / 2), water);
  waterMesh.position.set(R.xCenter, W, zMid);
  waterMesh.name = 'river_water';
  root.add(waterMesh);

  // ---------------- embankment walls ----------------
  const b = new Batch();
  const wallBottom = W - 4;
  for (let z = zs; z > ze; z -= 30) {
    const zc = z - 15;
    for (const [x, s] of [[xw, -1], [xe, 1]]) {
      // wall body (face at x)
      b.box('stone', 1.2, -wallBottom - 0.02, 30, x + s * 0.6 - s * 0.06, wallBottom / 2 - 0.01, zc);
      // coping stones (overhang toward water)
      b.box('coping', 1.35, 0.22, 30, x + s * 0.55 - s * 0.12, 0.06, zc);
    }
  }
  // drain outlets + iron mooring rings on the walls
  const rng = mulberry32(777);
  for (let z = zs - 10; z > ze; z -= 22 + rng() * 18) {
    for (const [x, s] of [[xw, -1], [xe, 1]]) {
      const y = W + 0.6 + rng() * 1.2;
      b.add('darkMetal', new THREE.CylinderGeometry(0.22, 0.22, 0.3, 12), x - s * 0.05, y, z, 0, 0, Math.PI / 2);
      b.add('hole', new THREE.CylinderGeometry(0.17, 0.17, 0.32, 12), x - s * 0.06, y, z, 0, 0, Math.PI / 2);
    }
  }
  const wallMat = surface({ map: tex.stonewall, nmap: tex.stonewall_n, rmap: tex.stonewall_r }, { uvScale: 1 / 2.4, tint: [0.78, 0.77, 0.75], normalScale: 1.4, macro: 0.7, streaks: 0.9, wetVert: 0.6 });
  {
    // algae / waterline band + darker wet lower wall
    const y = positionWorld.y;
    const band = smoothstep(W - 0.3, W + 0.15, y).mul(smoothstep(W + 1.4, W + 0.4, y));
    const n = mx_noise_float(positionWorld.mul(vec3(0.8, 3.0, 0.8))).mul(0.5).add(0.5);
    const below = smoothstep(W + 0.2, W - 0.2, y);
    const base = wallMat.colorNode;
    wallMat.colorNode = mix(mix(base, base.mul(vec3(0.35, 0.42, 0.3)), band.mul(n.mul(0.6).add(0.4))), base.mul(0.25), below);
  }
  const copingMat = surface({ map: tex.stonewall, nmap: tex.stonewall_n, rmap: tex.stonewall_r }, { uvScale: 1 / 1.2, tint: [0.62, 0.61, 0.6], normalScale: 0.8, macro: 0.4, streaks: false });

  // ---------------- promenade railing + lanterns (west bank, and east bank) ----------------
  const lights = [];
  const railX = xw - 0.3;
  const railZ0 = Math.min(P.zStart, zs - 2), railZ1 = Math.max(P.zEnd, ze + 2);
  const bridgeZ = ctx.layout.bridges[0].z;
  const gaps = (z) => Math.abs(z - bridgeZ) < 9.5; // stairs to bridge
  const banks = [{ x: railX, s: -1, z0: railZ0, z1: railZ1, lampEvery: 4 }, { x: xe + 0.3, s: 1, z0: zs - 2, z1: ze + 2, lampEvery: 8 }];
  for (const bank of banks) {
    let idx = 0;
    for (let z = bank.z0; z > bank.z1; z -= 2.4, idx++) {
      if (gaps(z) || gaps(z - 2.4)) continue;
      const lamp = idx % bank.lampEvery === 0;
      if (lamp) {
        // stone lantern post (tourou-like bollard): plinth + shaft + lit head + roof cap
        b.box('post', 0.46, 0.18, 0.46, bank.x, 0.09, z);
        b.box('post', 0.34, 1.0, 0.34, bank.x, 0.68, z);
        b.box('post', 0.5, 0.08, 0.5, bank.x, 1.22, z);
        b.box('lantern', 0.36, 0.42, 0.36, bank.x, 1.47, z);
        for (const [dx, dz] of [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]]) b.box('post', 0.07, 0.44, 0.07, bank.x + dx, 1.47, z + dz);
        b.add('post', new THREE.ConeGeometry(0.42, 0.24, 4, 1), bank.x, 1.8, z, 0, Math.PI / 4, 0);
        b.box('post', 0.12, 0.08, 0.12, bank.x, 1.94, z);
        if (z < 45 && z > -560 && (bank.s < 0 || idx % (bank.lampEvery * 2) === 0)) {
          const l = new THREE.PointLight(0xffb36b, bank.s < 0 ? 26 : 30, 13, 1.6);
          l.position.set(bank.x, 1.5, z);
          root.add(l); lights.push(l);
        }
        cuboid(ctx, bank.x, 1.0, z, 0.25, 1.0, 0.25);
      } else {
        b.box('post', 0.24, 1.05, 0.24, bank.x, 0.525, z);
        b.box('post', 0.3, 0.06, 0.3, bank.x, 1.08, z);
      }
      // rails to next post
      const zn = z - 2.4;
      if (zn > bank.z1 && !gaps(zn)) {
        for (const y of [0.42, 0.95]) b.box('railMetal', 0.06, 0.06, 2.4, bank.x, y, z - 1.2);
        // thin balusters
        for (let k = 1; k < 6; k++) b.box('railMetal', 0.025, 0.53, 0.025, bank.x, 0.685, z - k * 0.4);
        b.box('post', 0.3, 0.16, 2.4, bank.x, 0.08, z - 1.2); // kerb
      }
    }
    // continuous railing collider segments (skip bridge gap)
    const segs = [[bank.z0, bridgeZ + 9.5], [bridgeZ - 9.5, bank.z1]];
    for (const [a, c] of segs) if (a > c) cuboid(ctx, bank.x, 0.6, (a + c) / 2, 0.15, 0.6, (a - c) / 2);
  }
  // embankment wall colliders (stop walking into the river)
  cuboid(ctx, xw - 0.6, wallBottom / 2, zMid, 0.6, -wallBottom / 2 + 0.2, zLen / 2);
  cuboid(ctx, xe + 0.6, wallBottom / 2, zMid, 0.6, -wallBottom / 2 + 0.2, zLen / 2);

  const lanternMat = new THREE.MeshStandardNodeMaterial();
  {
    // warm paper/frosted panels with frame grid
    const pw2 = positionWorld;
    const grid = max(step(0.88, fract(pw2.y.mul(9))), step(0.9, fract(pw2.x.add(pw2.z).mul(7))));
    lanternMat.colorNode = vec3(0.9, 0.75, 0.55);
    lanternMat.emissiveNode = vec3(1.0, 0.62, 0.3).mul(mix(float(9), float(2.5), grid));
    lanternMat.roughnessNode = float(0.6);
  }
  const mats = {
    stone: wallMat, coping: copingMat,
    post: surface({ map: tex.concrete, nmap: tex.concrete_n, rmap: tex.concrete_r }, { uvScale: 1 / 2.5, tint: [0.62, 0.6, 0.57], normalScale: 1.4, macro: 0.5, streaks: 0.5 }),
    lantern: lanternMat,
    railMetal: metal({ color: [0.1, 0.1, 0.11], rough: 0.3, metal: 0.9 }),
    darkMetal: metal({ color: [0.12, 0.1, 0.09], rough: 0.5 }),
    hole: emissiveMat([0, 0, 0], 0),
  };
  const g = b.build(mats, { worldUV: { stone: 1, coping: 1, post: 1 }, chunk: 60 });
  g.name = 'riverbanks';
  root.add(g);
  return { api: { waterLevel: W, xWest: xw, xEast: xe, railX }, water: waterMesh, reflector: refl };
}
