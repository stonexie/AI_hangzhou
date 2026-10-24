import * as THREE from 'three/webgpu';
import { uv, positionWorld, vec3, vec2, float, mix, smoothstep, abs, fract, step, max, mx_noise_float, clamp, normalWorld } from 'three/tsl';
import { Batch, profileGeometry, beamBetween, cuboid, groundY, mulberry32 } from './util.js';
import { surface, metal, emissiveMat, U } from './materials.js';

// Elevated expressway: deck with lanes, hammerhead piers, sound barriers, sodium lamps, underside LEDs.
export function buildExpressway(ctx, tex, root) {
  const E = ctx.layout.expressway;
  const H = E.height; // road surface
  const Z = E.z, x0 = E.xStart, x1 = E.xEnd;
  const hw = E.width / 2;
  const b = new Batch();
  const river = ctx.layout.river;
  const laneW = 3.5;
  // left-hand traffic: eastbound (+x) lanes on the -z side
  const lanes = [
    { z: Z - laneW * 1.5, dir: 1 }, { z: Z - laneW * 0.5, dir: 1 },
    { z: Z + laneW * 0.5, dir: -1 }, { z: Z + laneW * 1.5, dir: -1 },
  ];
  const deckProf = [[-hw, 0], [-hw, -0.35], [-hw + 1.2, -0.7], [-5.2, -2.6], [5.2, -2.6], [hw - 1.2, -0.7], [hw, -0.35], [hw, 0]];
  for (let x = x0; x < x1; x += 40) {
    const xe = Math.min(x1, x + 40);
    b.add('concrete', profileGeometry(deckProf, x + 0.04, xe - 0.04), 0, H - 0.08, Z);
    b.box('asphalt', xe - x, 0.08, E.width - 1.0, (x + xe) / 2, H - 0.04, Z);
    for (const s of [-1, 1]) {
      // jersey-style parapet
      b.add('concrete', profileGeometry([[-0.3, 0], [0.3, 0], [0.12, 0.35], [0.1, 1.05], [-0.1, 1.05], [-0.12, 0.35]], x + 0.04, xe - 0.04), 0, H, Z + s * (hw - 0.3));
      // sound barrier posts + panels on top of parapet
      for (let px = x; px < xe; px += 4) {
        b.box('steel', 0.18, 2.8, 0.14, px + 0.1, H + 2.45, Z + s * (hw - 0.25));
      }
      b.box('barrier', xe - x - 0.1, 2.6, 0.04, (x + xe) / 2, H + 2.4, Z + s * (hw - 0.2));
      b.box('steel', xe - x, 0.12, 0.2, (x + xe) / 2, H + 3.8, Z + s * (hw - 0.25));
      b.box('steel', xe - x, 0.1, 0.18, (x + xe) / 2, H + 1.08, Z + s * (hw - 0.25));
      // underside edge LED strip
      b.box('ledWarm', xe - x - 1, 0.06, 0.05, (x + xe) / 2, H - 0.45, Z + s * (hw + 0.02));
    }
    // median barrier
    b.add('concrete', profileGeometry([[-0.3, 0], [0.3, 0], [0.12, 0.35], [0.1, 0.85], [-0.1, 0.85], [-0.12, 0.35]], x + 0.04, xe - 0.04), 0, H, Z);
  }
  // piers
  const pierXs = [];
  for (let x = x0 + 20; x < x1; x += 40) {
    if (Math.abs(x) < 18) continue;
    if (x > river.xCenter - river.halfWidth - 18 && x < river.xCenter + river.halfWidth + 18) continue;
    pierXs.push(x);
  }
  pierXs.push(-13, 13, river.xCenter - river.halfWidth - 14, river.xCenter + river.halfWidth + 14, river.xCenter);
  const colGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1);
  const capProf = [[-7.2, 0], [-7.2, -0.8], [-1.8, -2.6], [1.8, -2.6], [7.2, -0.8], [7.2, 0]];
  for (const px of pierXs) {
    const inRiver = px > river.xCenter - river.halfWidth && px < river.xCenter + river.halfWidth;
    const gy = inRiver ? river.waterLevel - 3 : groundY(ctx, px, Z);
    const top = H - 2.7 - 2.6;
    const h = top - gy;
    b.add('concrete', colGeo, px, gy + h / 2, Z, 0, 0, 0, 1.6, h, 1.9);
    b.add('concrete', profileGeometry(capProf, px - 1.5, px + 1.5), 0, H - 2.68, Z);
    if (inRiver) b.box('concrete', 5, 3.6, 6, px, river.waterLevel - 1.2, Z);
    for (const s of [-3.5, 3.5]) b.box('darkMetal', 1.0, 0.12, 1.0, px, H - 2.75, Z + s);
    // maintenance ladder cage + pipe
    b.box('darkMetal', 0.2, h, 0.2, px - 1.55, gy + h / 2, Z + 0.6);
    cuboid(ctx, px, gy + h / 2, Z, 1.6, h / 2, 1.9);
  }
  // deck collider (road surface)
  cuboid(ctx, (x0 + x1) / 2, H - 0.6, Z, (x1 - x0) / 2, 0.6, hw);
  for (const s of [-1, 1]) cuboid(ctx, (x0 + x1) / 2, H + 2, Z + s * (hw - 0.25), (x1 - x0) / 2, 2, 0.3);

  // lamp posts every 32m, alternating sides; sodium heads + LED variants
  const lights = [];
  const rng = mulberry32(2207);
  let k = 0;
  for (let x = x0 + 8; x < x1; x += 32, k++) {
    for (const s of [-1, 1]) {
      const zx = Z + s * (hw - 0.6);
      b.box('steel', 0.22, 10.5, 0.22, x, H + 5.25, zx);
      beamBetween(b, 'steel', new THREE.Vector3(x, H + 10.4, zx), new THREE.Vector3(x, H + 10.9, zx - s * 2.2), 0.14, 0.14);
      b.box('steel', 0.9, 0.22, 0.45, x, H + 10.85, zx - s * 2.6);
      b.box(k % 3 === 0 ? 'lampLed' : 'lampSodium', 0.75, 0.05, 0.35, x, H + 10.72, zx - s * 2.6);
      if (x > -180 && x < 300) {
        const l = new THREE.PointLight(k % 3 === 0 ? 0xdde8ff : 0xffa040, k % 3 === 0 ? 220 : 260, 25, 1.4);
        l.position.set(x, H + 10.0, zx - s * 2.6);
        root.add(l); lights.push(l);
      }
    }
  }
  // underside lights
  for (let x = -160; x <= 290; x += 24) {
    const l = new THREE.PointLight(0xffb070, 70, 18, 1.6);
    l.position.set(x, H - 3.6, Z);
    root.add(l);
  }
  for (let x = x0 + 6; x < x1; x += 12) for (const s of [-3.6, 3.6]) b.box('lampSodium', 1.4, 0.06, 0.2, x, H - 2.72, Z + s);

  // big overhead sign gantry over the expressway near the avenue (green JP expressway signs)
  for (const gx of [-60, 95]) {
    for (const s of [-1, 1]) b.box('steel', 0.4, 7.2, 0.4, gx, H + 3.6, Z + s * (hw - 0.6));
    b.box('steel', 0.4, 0.4, E.width, gx, H + 7.0, Z);
    b.box('sign', 0.15, 2.2, 5.5, gx + 0.3, H + 5.9, Z - 4);
    b.box('sign', 0.15, 2.2, 5.5, gx + 0.3, H + 5.9, Z + 3.2);
  }

  const asphalt = new THREE.MeshStandardNodeMaterial();
  {
    const pw = positionWorld;
    const n = mx_noise_float(pw.mul(0.4)).mul(0.5).add(0.5);
    const lz = pw.z.sub(Z);
    // lane markings: dashed lines at lane boundaries, solid edge lines
    const dash = step(0.5, fract(pw.x.div(12)));
    const lineAt = (zc, w) => smoothstep(w, w * 0.6, abs(lz.sub(zc)));
    const marks = max(max(lineAt(-laneW, 0.08).mul(dash), lineAt(laneW, 0.08).mul(dash)),
      max(lineAt(-laneW * 2 + 0.1, 0.1), lineAt(laneW * 2 - 0.1, 0.1)));
    const yellow = max(lineAt(-0.45, 0.08), lineAt(0.45, 0.08));
    let c = vec3(0.045, 0.045, 0.05).mul(mix(0.7, 1.2, n));
    c = mix(c, vec3(0.6, 0.6, 0.58), marks.mul(0.8));
    c = mix(c, vec3(0.65, 0.45, 0.08), yellow.mul(0.8));
    asphalt.colorNode = c.mul(mix(float(1), float(0.7), U.wet));
    asphalt.roughnessNode = clamp(mix(float(0.75), float(0.12), U.wet.mul(mix(0.6, 1.0, n))), 0.05, 1);
    asphalt.metalnessNode = float(0);
  }
  const barrier = new THREE.MeshStandardNodeMaterial();
  barrier.colorNode = vec3(0.05, 0.065, 0.07);
  barrier.metalnessNode = float(0.5);
  barrier.roughnessNode = float(0.12);
  barrier.metalnessNode = float(0);
  barrier.side = THREE.DoubleSide;
  const sign = new THREE.MeshStandardNodeMaterial();
  {
    const u = uv();
    const border = max(step(fract(u.x).oneMinus(), 0.03), step(fract(u.x), 0.03));
    sign.colorNode = vec3(0.02, 0.25, 0.12);
    sign.emissiveNode = vec3(0.05, 0.6, 0.3).mul(0.6);
    sign.roughnessNode = float(0.4);
  }
  const mats = {
    concrete: surface({ map: tex.concrete, nmap: tex.concrete_n, rmap: tex.concrete_r }, { uvScale: 1 / 4.5, tint: [0.88, 0.87, 0.85], normalScale: 1.2, macro: 0.65 }),
    asphalt, barrier, sign,
    steel: metal({ color: [0.28, 0.3, 0.32], rough: 0.45, metal: 0.8 }),
    darkMetal: metal({ color: [0.06, 0.06, 0.065], rough: 0.5 }),
    ledWarm: emissiveMat([1.0, 0.75, 0.45], 5),
    lampSodium: emissiveMat([1.0, 0.55, 0.15], 30),
    lampLed: emissiveMat([0.85, 0.92, 1.0], 30),
  };
  const g = b.build(mats, { worldUV: { concrete: 1 }, chunk: 80 });
  g.name = 'expressway';
  root.add(g);

  return {
    api: {
      z: Z, height: H, surfaceY: H, width: E.width, xStart: x0, xEnd: x1, laneWidth: laneW, lanes,
      speedLimit: 22, piers: pierXs,
    },
  };
}
