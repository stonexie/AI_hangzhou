import * as THREE from 'three/webgpu';
import { positionLocal, normalize, vec3, float, mix, smoothstep, max } from 'three/tsl';
import { hazeColor } from './atmo.js';

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Procedural "neon city" environment rendered once into a PMREM: dark blue/violet sky dome, glowing horizon,
// dark wet ground, and a ring of colored emissive panels (signs, windows, street light) so every PBR surface gets
// colored ambient specular / diffuse that matches the scene.
export function buildEnvironment(renderer) {
  const env = new THREE.Scene();
  const rnd = mulberry32(777);

  const domeMat = new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide, fog: false });
  const d = normalize(positionLocal);
  // sky dome: same haze function as the real sky, brightened a touch so ambient isn't black
  domeMat.colorNode = hazeColor(d).mul(1.3).add(vec3(0.004, 0.006, 0.014));
  env.add(new THREE.Mesh(new THREE.SphereGeometry(90, 48, 24), domeMat));

  // wet dark ground with faint reflected glow near the horizon
  const groundMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  groundMat.colorNode = mix(vec3(0.03, 0.022, 0.05), vec3(0.006, 0.006, 0.012), smoothstep(10.0, 60.0, positionLocal.length()));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(88, 48).rotateX(-Math.PI / 2), groundMat);
  ground.position.y = -3;
  env.add(ground);

  // neon panels around the horizon
  const palette = [
    [1.0, 0.08, 0.45], [1.0, 0.1, 0.7], [0.1, 0.75, 1.0], [0.05, 0.9, 0.8], [1.0, 0.45, 0.08],
    [0.6, 0.15, 1.0], [1.0, 0.85, 0.6], [0.9, 0.2, 0.15],
  ];
  const box = new THREE.BoxGeometry(1, 1, 1);
  // dark building silhouettes ringing the horizon (so reflections at grazing angles read as "city", not sky)
  const bldMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  bldMat.colorNode = mix(vec3(0.012, 0.010, 0.022), vec3(0.03, 0.022, 0.05), smoothstep(-3.0, 30.0, positionLocal.y.negate().add(30)));
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.1;
    const r = 55 + rnd() * 20;
    const mesh = new THREE.Mesh(box, bldMat);
    const h = 6 + rnd() * 22;
    mesh.scale.set(6 + rnd() * 8, h, 6);
    mesh.position.set(Math.sin(a) * r, h / 2 - 3, Math.cos(a) * r);
    mesh.lookAt(0, mesh.position.y, 0);
    env.add(mesh);
  }
  const mats = palette.map((c) => {
    const m = new THREE.MeshBasicNodeMaterial({ fog: false });
    m.color.setRGB(c[0], c[1], c[2], THREE.LinearSRGBColorSpace);
    return m;
  });
  for (let i = 0; i < 260; i++) {
    const ci = Math.floor(rnd() * palette.length);
    const mesh = new THREE.Mesh(box, mats[ci]);
    const a = rnd() * Math.PI * 2;
    const r = 30 + rnd() * 22;
    const tall = rnd() < 0.5;
    const k = 0.7 + rnd() * 1.8; // brightness via scale-independent trick: thicker = brighter in PMREM
    mesh.scale.set((tall ? 0.25 + rnd() * 0.4 : 0.8 + rnd() * 2.2) * k, (tall ? 1.2 + rnd() * 3 : 0.25 + rnd() * 0.6) * k, 0.1);
    mesh.position.set(Math.sin(a) * r, -2 + rnd() * rnd() * 22, Math.cos(a) * r);
    mesh.lookAt(0, mesh.position.y, 0);
    env.add(mesh);
  }
  for (const m of mats) m.color.multiplyScalar(3.5);
  // warm window grids (dim) on "buildings"
  const winMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  winMat.color.setRGB(0.5, 0.32, 0.18, THREE.LinearSRGBColorSpace);
  for (let i = 0; i < 40; i++) {
    const mesh = new THREE.Mesh(box, winMat);
    const a = rnd() * Math.PI * 2, r = 25 + rnd() * 25;
    mesh.scale.set(1.5 + rnd() * 3, 0.25, 0.1);
    mesh.position.set(Math.sin(a) * r, rnd() * 25, Math.cos(a) * r);
    mesh.lookAt(0, mesh.position.y, 0);
    env.add(mesh);
  }
  // a couple of overhead street-light strips (gives top-down cool spec on cars/wet ground)
  const stripMat = new THREE.MeshBasicNodeMaterial({ fog: false });
  stripMat.color.setRGB(1.2, 1.1, 1.3, THREE.LinearSRGBColorSpace);
  for (let i = 0; i < 4; i++) {
    const mesh = new THREE.Mesh(box, stripMat);
    mesh.scale.set(0.3, 0.1, 30);
    mesh.position.set(i < 2 ? -6 : 6, 9, (i % 2) * 10 - 5);
    env.add(mesh);
  }

  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(env, 0.03, 0.1, 200);
  pmrem.dispose();
  env.traverse((o) => { o.geometry?.dispose?.(); });
  return rt.texture;
}
