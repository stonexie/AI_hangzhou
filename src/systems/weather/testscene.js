// DEV ONLY (?wxtest=1, e.g. `node tools/shot.mjs --q "ultra&wxtest=1"`): crude neon street canyon so rain can be
// judged against lit backgrounds while other workstreams are still placeholders. Never loaded otherwise.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './common.js';

export function buildTestScene(ctx) {
  const { scene } = ctx;
  const g = new THREE.Group();
  g.name = 'weather.testscene';
  const rng = mulberry32(42);
  const dark = new THREE.MeshStandardNodeMaterial({ color: 0x15161c, roughness: 0.6, metalness: 0.1 });
  const cols = [0xff2a8a, 0x22e0ff, 0xffa020, 0x9a40ff, 0xff3030, 0x30ff90];
  for (const side of [-1, 1]) {
    for (let z = 50; z > -260; z -= 14 + rng() * 10) {
      const h = 12 + rng() * 40, d = 20, w = 12;
      const b = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), dark);
      b.position.set(side * (11 + d / 2), h / 2, z);
      g.add(b);
      // awning
      const aw = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, w * 0.7), dark);
      aw.position.set(side * 10, 3.4, z);
      g.add(aw);
      // neon signs + lights
      for (let k = 0; k < 2; k++) {
        const c = cols[Math.floor(rng() * cols.length)];
        const sm = new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(c).multiplyScalar(6) });
        const sh = 1 + rng() * 4;
        const s = new THREE.Mesh(new THREE.BoxGeometry(0.3, sh, 1.2), sm);
        const y = 5 + rng() * 10;
        s.position.set(side * 9.6, y, z + (rng() - 0.5) * 8);
        g.add(s);
        const L = new THREE.PointLight(c, 30, 20, 2);
        L.position.set(side * 8.8, y, s.position.z);
        g.add(L);
      }
    }
  }
  // street lamps
  for (let z = 40; z > -260; z -= 25) {
    const L = new THREE.PointLight(0xfff0d0, 60, 22, 2);
    L.position.set(5.5, 7, z);
    g.add(L);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(0xfff0d0).multiplyScalar(10) }));
    bulb.position.copy(L.position);
    g.add(bulb);
  }
  // elevated rail
  const rail = new THREE.Mesh(new THREE.BoxGeometry(800, 1.5, 9), dark);
  rail.position.set(0, 14, -140);
  g.add(rail);
  // a parked car-ish box
  const car = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.4, 4.5), dark);
  car.position.set(3, 0.7, -8);
  g.add(car);
  scene.add(g);
  return g;
}
