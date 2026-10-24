import * as THREE from 'three/webgpu';
import { positionWorld, vec3, float, mix, smoothstep, fract, step, abs, sin, time, mx_noise_float, clamp } from 'three/tsl';
import { Batch, beamBetween, cuboid, cuboidRot, groundY } from './util.js';
import { surface, metal, emissiveMat, U } from './materials.js';

// Steel tied-arch bridge across the river with lit arches, lamp posts, stairs down to both promenades.
export function buildBridge(ctx, tex, root) {
  const R = ctx.layout.river;
  const out = [];
  for (const bd of ctx.layout.bridges) {
    const Z = bd.z, D = bd.deckY;
    const xw = R.xCenter - R.halfWidth, xe = R.xCenter + R.halfWidth;
    const xa = xw - 14, xb = xe + 14; // abutments
    const hw = 6;
    const b = new Batch();
    // deck: concrete slab + steel edge girders
    b.box('concrete', xb - xa, 0.45, hw * 2, (xa + xb) / 2, D - 0.22, Z);
    b.box('paving', xb - xa, 0.05, hw * 2 - 0.8, (xa + xb) / 2, D + 0.02, Z);
    for (const s of [-1, 1]) {
      b.box('steelPaint', xb - xa, 1.4, 0.5, (xa + xb) / 2, D - 0.9, Z + s * (hw - 0.25));
      b.box('ledCyan', xb - xa - 2, 0.05, 0.04, (xa + xb) / 2, D - 1.55, Z + s * (hw + 0.02));
      // railing
      for (let x = xa + 1; x < xb; x += 2) b.box('steelPaint', 0.08, 1.1, 0.08, x, D + 0.55, Z + s * (hw - 0.15));
      b.box('steelPaint', xb - xa, 0.08, 0.12, (xa + xb) / 2, D + 1.1, Z + s * (hw - 0.15));
      b.box('glass', xb - xa, 0.9, 0.03, (xa + xb) / 2, D + 0.55, Z + s * (hw - 0.15));
    }
    // cross girders under deck
    for (let x = xa + 2; x < xb; x += 6) b.box('steelPaint', 0.4, 0.9, hw * 2 - 0.6, x, D - 0.85, Z);
    // arches (two ribs) between river walls, with hangers
    const ax0 = xw + 2, ax1 = xe - 2, rise = 13;
    const archPt = (t) => new THREE.Vector3(ax0 + (ax1 - ax0) * t, D + rise * 4 * t * (1 - t), 0);
    for (const s of [-1, 1]) {
      const zr = Z + s * (hw - 0.25);
      const N = 28;
      for (let i = 0; i < N; i++) {
        const a = archPt(i / N), c = archPt((i + 1) / N);
        a.z = zr; c.z = zr;
        beamBetween(b, 'steelPaint', a, c, 0.7, 1.0);
        const al = a.clone(), cl = c.clone(); al.y -= 0.55; cl.y -= 0.55;
        beamBetween(b, 'ledArch', al, cl, 0.2, 0.06);
      }
      for (let i = 1; i < 14; i++) {
        const t = i / 14, a = archPt(t);
        b.box('cable', 0.06, a.y - D, 0.06, a.x, (a.y + D) / 2, zr);
      }
    }
    // portal bracing between ribs
    for (const t of [0.3, 0.5, 0.7]) {
      const a = archPt(t);
      b.box('steelPaint', 0.5, 0.6, hw * 2 - 0.5, a.x, a.y, Z);
    }
    // piers at river walls + abutments
    for (const px of [xw - 0.5, xe + 0.5]) {
      const gy = R.waterLevel - 3;
      b.box('concrete', 3.0, D - 1.6 - gy, hw * 2 + 1, px, (D - 1.6 + gy) / 2, Z);
    }
    for (const px of [xa + 1.5, xb - 1.5]) {
      const gy = groundY(ctx, px, Z);
      b.box('concrete', 3.0, D - 1.6 - gy, hw * 2, px, (D - 1.6 + gy) / 2, Z);
      cuboid(ctx, px, (D + gy) / 2, Z, 1.5, (D - gy) / 2, hw);
    }
    // lamp posts on the deck
    const lights = [];
    for (let x = xa + 6; x < xb - 3; x += 16) {
      for (const s of [-1, 1]) {
        const zz = Z + s * (hw - 0.5);
        b.box('steelPaint', 0.14, 5.2, 0.14, x, D + 2.6, zz);
        b.box('steelPaint', 0.5, 0.18, 0.5, x, D + 5.25, zz);
        b.box('lampWarm', 0.42, 0.06, 0.42, x, D + 5.13, zz);
        const l = new THREE.PointLight(0xffd3a0, 90, 20, 1.5);
        l.position.set(x, D + 4.8, zz - s * 0.4);
        root.add(l); lights.push(l);
      }
    }
    // underside floodlights onto the water (warm) + arch uplights
    for (const x of [xw + 12, R.xCenter, xe - 12]) {
      const l = new THREE.PointLight(0x9fe8ff, 120, 22, 1.4);
      l.position.set(x, D - 2.2, Z); root.add(l);
    }
    // stairs: from promenade level up to deck, on the land side of each embankment, running along z
    const stairs = [{ x: xw - 9, dir: 1 }, { x: xe + 9, dir: -1 }];
    for (const st of stairs) {
      const z0 = Z + hw + 1, run = 14, steps = 28;
      const gy = groundY(ctx, st.x, z0 + run);
      // landing
      b.box('concrete', 3.2, 0.4, 3, st.x, D - 0.2, Z + hw + 0.5);
      for (let i = 0; i < steps; i++) {
        const y = D - (i + 1) * (D - gy) / steps;
        const z = z0 + (i + 0.5) * run / steps;
        b.box('paving', 3.0, 0.06, run / steps + 0.02, st.x, y + (D - gy) / steps, z);
        b.box('concrete', 3.0, (D - gy) / steps, run / steps, st.x, y + (D - gy) / steps / 2, z);
      }
      // stringer walls + handrails
      for (const s of [-1, 1]) {
        const a = new THREE.Vector3(st.x + s * 1.6, D + 0.5, z0), c = new THREE.Vector3(st.x + s * 1.6, gy + 0.5, z0 + run);
        beamBetween(b, 'concrete', a, c, 0.25, 1.2);
        const a2 = a.clone(), c2 = c.clone(); a2.y += 0.5; c2.y += 0.5;
        beamBetween(b, 'steelPaint', a2, c2, 0.06, 0.06);
        const a3 = a.clone(), c3 = c.clone(); a3.y -= 0.35; c3.y -= 0.35; a3.x -= s * 0.14; c3.x -= s * 0.14;
        beamBetween(b, 'ledWarm', a3, c3, 0.02, 0.04);
      }
      // ramp collider (smooth slope for the character controller)
      const len = Math.hypot(run, D - gy), ang = Math.atan2(D - gy, run);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
      cuboidRot(ctx, st.x, (D + gy) / 2 - 0.15, z0 + run / 2, 1.5, 0.15, len / 2, q);
    }
    cuboid(ctx, (xa + xb) / 2, D - 0.25, Z, (xb - xa) / 2, 0.25, hw);
    for (const s of [-1, 1]) cuboid(ctx, (xa + xb) / 2, D + 0.6, Z + s * (hw - 0.15), (xb - xa) / 2, 0.6, 0.1);

    const steelPaint = metal({ color: [0.16, 0.18, 0.2], rough: 0.4, metal: 0.6 });
    const glass = new THREE.MeshStandardNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    glass.colorNode = vec3(0.3, 0.4, 0.45); glass.opacityNode = float(0.22); glass.roughnessNode = float(0.05);
    const ledArch = new THREE.MeshStandardNodeMaterial();
    {
      // slow travelling pulse of cyan/white along the arch
      const ph = fract(positionWorld.x.mul(0.02).sub(time.mul(0.15)));
      ledArch.colorNode = vec3(0.02);
      ledArch.emissiveNode = mix(vec3(0.2, 0.9, 1.0).mul(4), vec3(1.0, 1.0, 1.0).mul(9), smoothstep(0.9, 1.0, ph));
    }
    const mats = {
      concrete: surface({ map: tex.concrete, nmap: tex.concrete_n, rmap: tex.concrete_r }, { uvScale: 1 / 3.5, tint: [0.8, 0.8, 0.8] }),
      paving: surface({ map: tex.stonewall, nmap: tex.stonewall_n, rmap: tex.stonewall_r }, { uvScale: 1 / 1.5, tint: [0.5, 0.5, 0.52], streaks: false, wetRough: 0.04 }),
      steelPaint, glass, ledArch,
      cable: metal({ color: [0.3, 0.3, 0.32], rough: 0.3 }),
      ledCyan: emissiveMat([0.2, 0.85, 1.0], 6),
      ledWarm: emissiveMat([1.0, 0.7, 0.4], 4),
      lampWarm: emissiveMat([1.0, 0.85, 0.65], 25),
    };
    const g = b.build(mats, { worldUV: { concrete: 1, paving: 1 }, chunk: 60 });
    g.name = 'bridge';
    root.add(g);
    out.push({ z: Z, deckY: D, xStart: xa, xEnd: xb, width: hw * 2 });
  }
  return { api: out };
}
