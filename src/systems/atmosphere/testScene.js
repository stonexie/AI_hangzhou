import * as THREE from 'three/webgpu';
import {
  vec2, vec3, float, texture, mix, smoothstep, step, floor, fract, abs, select, hash, positionWorld, normalWorld,
  max, min, uniform, time, sin,
} from 'three/tsl';
import { noiseTex } from './atmo.js';
import { createLightShaft } from './lightShaft.js';

// TEMPORARY atmosphere test scene — only built when the URL contains "atmotest".
// Rough stand-in for the city (avenue, alley, rail, river, skyline) to tune light/fog/post.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function facadeMaterial(scale = 1, litChance = 0.22) {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.75, metalness: 0.1 });
  const P = positionWorld;
  const N = normalWorld;
  const side = abs(N.x).greaterThan(0.5);
  const u = select(side, P.z, P.x).div(2.2 * scale);
  const v = P.y.div(3.4 * scale);
  const cell = floor(vec2(u, v));
  const f = fract(vec2(u, v));
  const facing0 = step(abs(N.y), 0.5);
  const win = step(0.25, f.x).mul(step(f.x, 0.75)).mul(step(0.35, f.y)).mul(step(f.y, 0.78)).mul(facing0);
  const h = hash(cell.x.mul(13.7).add(cell.y.mul(71.3)).add(floor(select(side, P.x, P.z).div(7)).mul(5.1)));
  const lit = step(1 - litChance, h);
  const warm = mix(vec3(1.0, 0.55, 0.25), vec3(0.6, 0.75, 1.0), step(0.8, hash(h.mul(91.1))));
  const facing = step(abs(N.y), 0.5);
  const nz = texture(noiseTex, P.xy.mul(0.05).add(P.zy.mul(0.05))).g;
  m.colorNode = mix(vec3(0.05, 0.05, 0.055), vec3(0.11, 0.1, 0.1), nz).mul(float(1).sub(win.mul(0.6)));
  m.emissiveNode = warm.mul(win).mul(lit).mul(facing).mul(h.mul(0.8).add(0.25));
  m.roughnessNode = mix(float(0.8), float(0.25), win);
  return m;
}

export function buildTestScene(ctx) {
  const { scene } = ctx;
  const rnd = mulberry32(99);
  const group = new THREE.Group();
  group.name = 'atmotest';
  scene.add(group);
  const box = new THREE.BoxGeometry(1, 1, 1);

  // wet ground with puddles
  const groundMat = new THREE.MeshStandardNodeMaterial({ metalness: 0.0 });
  const gp = positionWorld.xz;
  const puddle = smoothstep(0.45, 0.6, texture(noiseTex, gp.mul(0.02)).r);
  const grit = texture(noiseTex, gp.mul(0.35)).b;
  groundMat.colorNode = mix(vec3(0.035, 0.034, 0.036), vec3(0.012, 0.012, 0.014), puddle).mul(grit.mul(0.6).add(0.7));
  groundMat.roughnessNode = mix(grit.mul(0.25).add(0.22), float(0.03), puddle);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2), groundMat);
  group.add(ground);

  // sidewalks
  const swMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2a2e, roughness: 0.3 });
  for (const s of [-1, 1]) {
    const sw = new THREE.Mesh(box, swMat);
    sw.scale.set(4, 0.15, 480); sw.position.set(s * 8, 0.075, -180);
    group.add(sw);
  }
  // lane markings
  const laneMat = new THREE.MeshStandardNodeMaterial({ color: 0x777777, roughness: 0.3 });
  for (let z = 50; z > -400; z -= 8) {
    const l = new THREE.Mesh(box, laneMat);
    l.scale.set(0.15, 0.01, 3); l.position.set(0, 0.005, z);
    group.add(l);
  }

  // buildings lining the avenue + cross streets
  const fac = facadeMaterial();
  const facMesh = new THREE.InstancedMesh(box, fac, 600);
  let n = 0;
  const dummy = new THREE.Object3D();
  const signs = [];
  const neonPalette = [
    [1.0, 0.1, 0.5], [1.0, 0.15, 0.8], [0.15, 0.8, 1.0], [0.1, 1.0, 0.85], [1.0, 0.5, 0.1], [0.7, 0.2, 1.0],
    [1.0, 0.95, 0.85], [1.0, 0.2, 0.15],
  ];
  const addB = (x, z, w, d, h) => {
    if (n >= 600) return;
    dummy.position.set(x, h / 2, z); dummy.scale.set(w, h, d); dummy.rotation.set(0, 0, 0); dummy.updateMatrix();
    facMesh.setMatrixAt(n++, dummy.matrix);
  };
  for (const s of [-1, 1]) {
    for (let z = 50; z > -420; ) {
      const w = 10 + rnd() * 14;
      const zc = z - w / 2;
      const inCross = [-60, -180, -300].some((cz) => Math.abs(zc - cz) < w / 2 + 5);
      const inAlley = s < 0 && Math.abs(zc + 100) < w / 2 + 2.5;
      if (!inCross && !inAlley) {
        const h = 14 + rnd() * 45;
        addB(s * (10 + 14), zc, 28, w - 0.5, h);
        // vertical signs
        if (rnd() < 0.8) signs.push({ x: s * 10.6, y: 4 + rnd() * 10, z: zc + (rnd() - 0.5) * w * 0.6, vertical: true, s });
        if (rnd() < 0.7) signs.push({ x: s * 10.15, y: 3 + rnd() * 2, z: zc + (rnd() - 0.5) * w * 0.4, vertical: false, s });
      }
      z -= w;
    }
  }
  // alley buildings
  for (let x = -11; x > -95; ) {
    const w = 8 + rnd() * 8;
    for (const s of [-1, 1]) {
      const h = 8 + rnd() * 16 + (x < -50 ? 7 : 0);
      addB(x - w / 2, -100 + s * (2.25 + 6), w - 0.3, 12, h);
      if (rnd() < 0.6) signs.push({ x: x - w / 2, y: 3 + rnd() * 6 + (x < -50 ? 7 : 0), z: -100 + s * 2.4, vertical: true, s, alley: true });
    }
    x -= w;
  }
  // outer blocks
  for (let i = 0; i < 160; i++) {
    const x = (rnd() - 0.5) * 700, z = 60 - rnd() * 700;
    if (Math.abs(x) < 40 || (x > 120 && x < 230)) continue;
    addB(x, z, 15 + rnd() * 25, 15 + rnd() * 25, 15 + rnd() * 70);
  }
  facMesh.count = n;
  facMesh.instanceMatrix.needsUpdate = true;
  group.add(facMesh);

  // skyline mega towers
  const skyMat = facadeMaterial(1.6, 0.45);
  const sky = new THREE.InstancedMesh(box, skyMat, 140);
  for (let i = 0; i < 140; i++) {
    const a = rnd() * Math.PI * 2;
    const r = 450 + rnd() * 1050;
    const h = 150 + rnd() * rnd() * 370;
    const w = 30 + rnd() * 50;
    dummy.position.set(Math.sin(a) * r, h / 2, Math.cos(a) * r - 150);
    dummy.scale.set(w, h, w * (0.7 + rnd() * 0.6)); dummy.updateMatrix();
    sky.setMatrixAt(i, dummy.matrix);
    if (rnd() < 0.5) {
      const c = neonPalette[Math.floor(rnd() * 6)];
      const sm = new THREE.MeshBasicNodeMaterial();
      sm.color.setRGB(c[0] * 25, c[1] * 25, c[2] * 25, THREE.LinearSRGBColorSpace);
      const strip = new THREE.Mesh(box, sm);
      strip.scale.set(3, h * 0.5, w * 0.2);
      strip.position.set(dummy.position.x, h * 0.6, dummy.position.z);
      strip.lookAt(0, h * 0.6, -150);
      strip.translateZ(-w * 0.55);
      group.add(strip);
    }
  }
  sky.instanceMatrix.needsUpdate = true;
  group.add(sky);

  // neon signs with lights
  const signGeo = box;
  let lights = 0;
  for (const s of signs) {
    const c = neonPalette[Math.floor(rnd() * neonPalette.length)];
    const k = 6 + rnd() * 10;
    const m = new THREE.MeshBasicNodeMaterial();
    m.color.setRGB(c[0] * k, c[1] * k, c[2] * k, THREE.LinearSRGBColorSpace);
    const mesh = new THREE.Mesh(signGeo, m);
    if (s.vertical) mesh.scale.set(s.alley ? 0.8 : 0.4, s.alley ? 2 : 5 + rnd() * 5, s.alley ? 0.15 : 1.4);
    else mesh.scale.set(0.2, 1.0, 4 + rnd() * 4);
    if (s.alley) mesh.scale.set(0.5, 1.6, 0.1);
    mesh.position.set(s.x, s.y, s.z);
    group.add(mesh);
    if (lights < 120) {
      const L = new THREE.PointLight(new THREE.Color(c[0], c[1], c[2]), 12, 16, 2);
      L.position.set(s.x - Math.sign(s.x) * 1.2, s.y, s.z);
      if (s.alley) L.position.set(s.x, s.y, s.z - s.s * 1);
      group.add(L); lights++;
    }
  }

  // red lanterns in alley
  const lanternMat = new THREE.MeshBasicNodeMaterial();
  lanternMat.color.setRGB(4, 0.5, 0.15, THREE.LinearSRGBColorSpace);
  const lgeo = new THREE.SphereGeometry(0.3, 16, 12).scale(1, 1.4, 1);
  for (let x = -14; x > -88; x -= 4.5) {
    for (const s of [-1, 1]) {
      const y = x < -40 ? 3 + Math.min(7, (-40 - x) / 22 * 7) : 3;
      const l = new THREE.Mesh(lgeo, lanternMat);
      l.position.set(x + rnd(), y + 0.3, -100 + s * 1.9);
      group.add(l);
    }
    const L = new THREE.PointLight(0xff5530, 5, 10, 2);
    L.position.set(x, 3.2, -100);
    group.add(L);
  }
  // alley stairs
  const stairMat = new THREE.MeshStandardNodeMaterial({ color: 0x303034, roughness: 0.2 });
  for (let i = 0; i < 40; i++) {
    const st = new THREE.Mesh(box, stairMat);
    const x0 = -40 - i * (22 / 40);
    st.scale.set(22 / 40 + 0.01, (i + 1) * (7 / 40), 4.5);
    st.position.set(x0 - 11 / 40, st.scale.y / 2, -100);
    group.add(st);
  }
  const upper = new THREE.Mesh(box, stairMat);
  upper.scale.set(30, 7, 4.5); upper.position.set(-77, 3.5, -100);
  group.add(upper);

  // street lamps with light shafts
  const poleMat = new THREE.MeshStandardNodeMaterial({ color: 0x222226, roughness: 0.4, metalness: 0.8 });
  const lampMat = new THREE.MeshBasicNodeMaterial();
  lampMat.color.setRGB(12, 10, 8, THREE.LinearSRGBColorSpace);
  for (let z = 40; z > -400; z -= 30) {
    for (const s of [-1, 1]) {
      const pole = new THREE.Mesh(box, poleMat);
      pole.scale.set(0.15, 7, 0.15); pole.position.set(s * 6.5, 3.5, z);
      group.add(pole);
      const head = new THREE.Mesh(box, lampMat);
      head.scale.set(0.9, 0.12, 0.35); head.position.set(s * 5.8, 7, z);
      group.add(head);
      const L = new THREE.PointLight(0xffd0a0, 30, 20, 2);
      L.position.set(s * 5.8, 6.7, z);
      group.add(L);
      group.add(createLightShaft({ position: [s * 5.8, 6.9, z], length: 7.2, radius: 3.2, color: new THREE.Color(1, 0.8, 0.6), intensity: 0.05 }));
    }
  }

  // elevated rail & expressway
  const concrete = new THREE.MeshStandardNodeMaterial({ color: 0x3a3a40, roughness: 0.6 });
  const rail = new THREE.Mesh(box, concrete);
  rail.scale.set(800, 2, 9); rail.position.set(0, 14, -140);
  group.add(rail);
  const expw = new THREE.Mesh(box, concrete);
  expw.scale.set(800, 2.5, 16); expw.position.set(0, 22, -240);
  group.add(expw);
  const stripM = new THREE.MeshBasicNodeMaterial();
  stripM.color.setRGB(0.3, 2.5, 4, THREE.LinearSRGBColorSpace);
  for (const zz of [-135.4, -144.6]) {
    const st = new THREE.Mesh(box, stripM);
    st.scale.set(800, 0.15, 0.1); st.position.set(0, 13.2, zz);
    group.add(st);
  }
  for (let x = -380; x < 400; x += 40) {
    for (const [zz, hh] of [[-140, 13], [-240, 21]]) {
      const p = new THREE.Mesh(box, concrete);
      p.scale.set(2, hh, 2); p.position.set(x + (Math.abs(x) < 10 ? 12 : 0), hh / 2, zz);
      group.add(p);
    }
  }
  // overlook balcony building
  addB(46, -54, 14, 14, 25);
  facMesh.count = n;

  // river
  const waterMat = new THREE.MeshStandardNodeMaterial({ color: 0x050608, roughness: 0.04, metalness: 0.0 });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(70, 900).rotateX(-Math.PI / 2), waterMat);
  water.position.set(175, -2.99, -250);
  group.add(water);
  // carve: river bed is just a lower plane; hide ground there
  const promMat = new THREE.MeshStandardNodeMaterial({ color: 0x2a2626, roughness: 0.15 });
  const prom = new THREE.Mesh(box, promMat);
  prom.scale.set(12, 0.2, 540); prom.position.set(134, 0.1, -230);
  group.add(prom);
  for (let z = 30; z > -500; z -= 10) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), lampMat);
    l.position.set(139.5, 0.5, z);
    group.add(l);
    if (z % 20 === 0) {
      const L = new THREE.PointLight(0xffc080, 15, 10, 2);
      L.position.set(139, 1.2, z);
      group.add(L);
    }
  }
  // pink cherry blossom blobs
  const blossomMat = new THREE.MeshStandardNodeMaterial({ color: 0xff6aa0, roughness: 0.8 });
  blossomMat.emissive = new THREE.Color(0.25, 0.04, 0.1);
  for (let z = 20; z > -400; z -= 14) {
    const b = new THREE.Mesh(new THREE.IcosahedronGeometry(3, 1), blossomMat);
    b.position.set(129 + rnd() * 2, 5 + rnd(), z);
    b.scale.set(1.3, 0.8, 1.3);
    group.add(b);
  }
  // river bank walls so ground plane doesn't cover water
  ground.geometry = new THREE.PlaneGeometry(3000, 3000).rotateX(-Math.PI / 2);
  const bankHide = new THREE.Mesh(box, concrete);
  bankHide.visible = false;
  // instead cut ground: split into two planes
  group.remove(ground);
  const gL = new THREE.Mesh(new THREE.PlaneGeometry(1640, 3000).rotateX(-Math.PI / 2), groundMat);
  gL.position.set(140 - 820, 0, 0);
  const gR = new THREE.Mesh(new THREE.PlaneGeometry(1290, 3000).rotateX(-Math.PI / 2), groundMat);
  gR.position.set(210 + 645, 0, 0);
  group.add(gL, gR);
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(70, 3000).rotateX(-Math.PI / 2), new THREE.MeshStandardNodeMaterial({ color: 0x050505 }));
  bed.position.set(175, -3.5, 0);
  group.add(bed);
  for (const bx of [140, 210]) {
    const wall = new THREE.Mesh(box, concrete);
    wall.scale.set(0.5, 3, 3000); wall.position.set(bx, -1.5, 0);
    group.add(wall);
  }
  // bridge
  const bridge = new THREE.Mesh(box, concrete);
  bridge.scale.set(80, 1.5, 12); bridge.position.set(175, 8, -260);
  group.add(bridge);

  // car with tail lights on the avenue
  const carMat = new THREE.MeshStandardNodeMaterial({ color: 0x101014, roughness: 0.15, metalness: 0.9 });
  const car = new THREE.Mesh(box, carMat);
  car.scale.set(1.9, 1.2, 4.5); car.position.set(1.8, 0.7, 5);
  group.add(car);
  const tailMat = new THREE.MeshBasicNodeMaterial();
  tailMat.color.setRGB(10, 0.3, 0.2, THREE.LinearSRGBColorSpace);
  for (const s of [-1, 1]) {
    const t = new THREE.Mesh(box, tailMat);
    t.scale.set(0.5, 0.1, 0.05); t.position.set(1.8 + s * 0.6, 0.95, 7.27);
    group.add(t);
  }
  return group;
}
