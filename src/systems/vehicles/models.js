// Loads the Blender-built vehicle GLBs and converts them into instancing-friendly data:
//   per type, per LOD: body geometry merged per material + wheel geometry per material + 4 wheel slots.
// Also adds UV-mapped Hangzhou `浙A` front/rear license plates, the red glowing "空车" roof sign on `taxi`,
// and replaces `av` (flying car) with a modern 4-rotor aerial photography quadcopter drone.
import * as THREE from 'three/webgpu';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const TYPES = ['hero', 'kei', 'taxi', 'van', 'av'];
const LOD_SUFFIX = ['', '_lod1', '_lod2', '_lod3'];
const FLIP = new THREE.Matrix4().makeRotationY(Math.PI); // GLB front is +Z -> rotate to -Z forward

function cleanGeom(g, m) {
  const out = new THREE.BufferGeometry();
  const pos = g.getAttribute('position').clone();
  out.setAttribute('position', pos);
  if (g.getAttribute('normal')) out.setAttribute('normal', g.getAttribute('normal').clone());
  if (g.getAttribute('uv')) {
    out.setAttribute('uv', g.getAttribute('uv').clone());
  } else {
    out.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(pos.count * 2), 2));
  }
  if (g.index) out.setIndex(g.index.clone());
  if (m) out.applyMatrix4(m);
  if (!out.getAttribute('normal')) out.computeVertexNormals();
  return out;
}

function ensureIndexed(list) {
  const anyNon = list.some((g) => !g.index);
  if (!anyNon) return list;
  return list.map((g) => (g.index ? g.toNonIndexed() : g));
}

// Helper: creates a double-sided or single-sided UV-mapped quad in car-local space
function makeQuadGeo(cx, cy, cz, w, h, faceDirZ = 1) {
  const g = new THREE.PlaneGeometry(w, h);
  if (faceDirZ < 0) {
    // Facing -Z (front of car): rotate Y by PI so normal points toward -Z and UV (0->1) reads left-to-right when viewed from front
    g.rotateY(Math.PI);
  }
  g.translate(cx, cy, cz);
  return g;
}

// Build UV-mapped front & rear Hangzhou `浙A` license plate geometry for each ground car type
function buildHangzhouPlateGeos(type) {
  const specs = {
    hero: { yf: 0.46, zf: -2.492, yr: 0.565, zr: 2.456 },
    kei:  { yf: 0.49, zf: -1.724, yr: 0.490, zr: 1.714 },
    taxi: { yf: 0.52, zf: -2.390, yr: 0.520, zr: 2.390 },
    van:  { yf: 0.48, zf: -3.035, yr: 0.420, zr: 2.980 },
  }[type];
  if (!specs) return [];
  const pw = 0.44, ph = 0.14;
  return [
    makeQuadGeo(0, specs.yf, specs.zf, pw, ph, -1), // Front license plate (facing -Z)
    makeQuadGeo(0, specs.yr, specs.zr, pw, ph, +1), // Rear license plate (facing +Z)
  ];
}

// Build the Hangzhou Taxi roof sign housing + glowing red "空车" front/rear LED panels + windshield "空车" plaque
function buildTaxiKongcheGeos() {
  const housingGeos = [];
  const signGeos = [];

  // Roof dome casing (`trim` material) sitting on top of the taxi roof (y = 1.506)
  const baseBox = new THREE.BoxGeometry(0.56, 0.035, 0.18);
  baseBox.translate(0, 1.522, -0.15);
  housingGeos.push(cleanGeom(baseBox, null));

  const mainBox = new THREE.BoxGeometry(0.50, 0.175, 0.13);
  mainBox.translate(0, 1.615, -0.15);
  housingGeos.push(cleanGeom(mainBox, null));

  // Front & Rear glowing "空车" LED display panels on the roof sign (`lights_aux` material, UV 0..1)
  signGeos.push(makeQuadGeo(0, 1.615, -0.218, 0.47, 0.155, -1)); // Front roof "空车" sign (facing -Z)
  signGeos.push(makeQuadGeo(0, 1.615, -0.082, 0.47, 0.155, +1)); // Rear roof "空车" sign (facing +Z)

  // Classic passenger-side windshield red "空车" LED plaque (`lights_aux` material)
  signGeos.push(makeQuadGeo(-0.34, 1.15, -0.82, 0.24, 0.085, -1));

  return { housingGeos, signGeos };
}

// Build a sleek 4-rotor aerial photography quadcopter drone to replace the sci-fi flying car (`av`)
function buildDroneModel() {
  const byMat = new Map();
  const add = (mat, geo) => {
    const g = cleanGeom(geo, null);
    if (!byMat.has(mat)) byMat.set(mat, []);
    byMat.get(mat).push(g);
  };

  // Central fuselage pod (sleek modern DJI-style quadcopter body)
  const core = new THREE.BoxGeometry(0.46, 0.16, 0.68);
  core.translate(0, 0.48, 0);
  add('paint', core);

  const topShell = new THREE.CylinderGeometry(0.20, 0.26, 0.09, 12);
  topShell.scale(1.0, 1.0, 1.35);
  topShell.translate(0, 0.58, 0);
  add('paint', topShell);

  // Under-body 3-axis camera gimbal & optical lens
  const gimbal = new THREE.SphereGeometry(0.11, 12, 10);
  gimbal.translate(0, 0.34, -0.22);
  add('trim', gimbal);

  const lens = new THREE.CylinderGeometry(0.055, 0.055, 0.06, 12);
  lens.rotateX(Math.PI / 2);
  lens.translate(0, 0.34, -0.31);
  add('glass', lens);

  // Two landing skids
  for (const sx of [-0.24, 0.24]) {
    const skid = new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8);
    skid.rotateX(Math.PI / 2);
    skid.translate(sx, 0.20, 0);
    add('trim', skid);

    for (const sz of [-0.20, 0.20]) {
      const strut = new THREE.CylinderGeometry(0.015, 0.015, 0.26, 6);
      strut.translate(sx, 0.33, sz);
      add('trim', strut);
    }
  }

  // 4 diagonal rotor arms + motor pods + rotor guard rings + spinning rotor discs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const rx = sx * 0.62;
      const rz = sz * 0.62;

      const arm = new THREE.BoxGeometry(0.05, 0.04, 0.72);
      arm.rotateY(sx * sz > 0 ? Math.PI / 4 : -Math.PI / 4);
      arm.translate(rx * 0.55, 0.49, rz * 0.55);
      add('trim', arm);

      const motor = new THREE.CylinderGeometry(0.065, 0.055, 0.09, 10);
      motor.translate(rx, 0.52, rz);
      add('metal', motor);

      // Rotor guard ring & swept rotor disc
      const ring = new THREE.TorusGeometry(0.34, 0.016, 6, 20);
      ring.rotateX(Math.PI / 2);
      ring.translate(rx, 0.56, rz);
      add('trim', ring);

      const blade1 = new THREE.BoxGeometry(0.64, 0.008, 0.055);
      blade1.rotateY(0.4);
      blade1.translate(rx, 0.565, rz);
      add('chrome', blade1);

      const blade2 = new THREE.BoxGeometry(0.64, 0.008, 0.055);
      blade2.rotateY(0.4 + Math.PI / 2);
      blade2.translate(rx, 0.565, rz);
      add('chrome', blade2);

      // Under-motor navigation LED pad
      const led = new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8);
      led.translate(rx, 0.465, rz);
      add(sz < 0 ? 'lights_head' : 'lights_tail', led);
    }
  }

  // Subtle status indicator strip on body
  const statusBar = new THREE.BoxGeometry(0.28, 0.025, 0.04);
  statusBar.translate(0, 0.48, 0.35);
  add('lights_aux', statusBar);

  const parts = [];
  const box = new THREE.Box3();
  for (const [mat, list] of byMat) {
    const g = list.length === 1 ? list[0] : mergeGeometries(ensureIndexed(list), false);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    box.union(g.boundingBox);
    parts.push({ mat, geom: g });
  }
  const lodData = { parts, wheel: [], slots: [], wheelRadius: 0.1, box };
  const size = box.getSize(new THREE.Vector3());
  return {
    type: 'av',
    lods: [lodData, lodData, lodData, lodData],
    slots: [],
    wheelRadius: 0.1,
    box,
    size,
    length: size.z,
    width: size.x,
    height: size.y,
    axleF: -0.4,
    axleR: 0.4,
  };
}

function extract(gltf, type) {
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const body = new Map();
  const wheelGeo = new Map();
  const slots = [];
  let wheelRadius = 0.33;
  const wheelNodes = [];
  scene.traverse((o) => { if (/^wheel_/.test(o.name) && !wheelNodes.includes(o) && !/^wheel_/.test(o.parent?.name || '')) wheelNodes.push(o); });
  const isWheelDesc = (o) => { for (let p = o; p; p = p.parent) if (wheelNodes.includes(p)) return p; return null; };
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const wn = isWheelDesc(o);
    const name = (o.material?.name || 'trim').replace(/\.\d+$/, '');
    if (wn) {
      if (wn.name !== 'wheel_FR') return; // shared mesh, take one copy in wheel-local space
      const local = new THREE.Matrix4().copy(wn.matrixWorld).invert().multiply(o.matrixWorld);
      const g = cleanGeom(o.geometry, local);
      if (!wheelGeo.has(name)) wheelGeo.set(name, []);
      wheelGeo.get(name).push(g);
    } else {
  // Skip original UV-less `plate` and `lights_aux` meshes on taxi/sedan/suv so only `taxi` gets the roof sign
      if (name === 'plate') return;
      if ((type === 'taxi' || type === 'sedan' || type === 'suv') && name === 'lights_aux') return;
      const matXform = new THREE.Matrix4().multiplyMatrices(FLIP, o.matrixWorld);
      if (type === 'suv') {
        // Give the SUV a taller body stance (+12% height, +4% width, slightly shorter overhang)
        const suvScale = new THREE.Matrix4().makeScale(1.04, 1.13, 0.98);
        matXform.premultiply(suvScale);
      }
      const g = cleanGeom(o.geometry, matXform);
      if (!body.has(name)) body.set(name, []);
      body.get(name).push(g);
    }
  });

  // Add UV-mapped Hangzhou `浙A` front & rear license plates
  const plateGeos = buildHangzhouPlateGeos(type);
  if (plateGeos.length) {
    body.set('plate', plateGeos);
  }

  // Add Hangzhou Taxi roof sign housing + glowing red "空车" front/rear LED displays ONLY on `taxi`
  if (type === 'taxi') {
    const { housingGeos, signGeos } = buildTaxiKongcheGeos();
    if (!body.has('trim')) body.set('trim', []);
    body.get('trim').push(...housingGeos);
    body.set('lights_aux', signGeos);
  }

  // Add SUV rear fastback/hatchback D-pillar upper cabin & roof luggage rails on `suv`
  if (type === 'suv') {
    if (!body.has('paint')) body.set('paint', []);
    if (!body.has('glass')) body.set('glass', []);
    if (!body.has('trim')) body.set('trim', []);

    // Rear SUV hatchback roof extension & D-pillar
    const rearCabin = new THREE.BoxGeometry(1.44, 0.44, 1.25);
    rearCabin.translate(0, 1.38, 1.22);
    body.get('paint').push(cleanGeom(rearCabin, null));

    const rearSideGlass = new THREE.BoxGeometry(1.47, 0.34, 1.05);
    rearSideGlass.translate(0, 1.38, 1.18);
    body.get('glass').push(cleanGeom(rearSideGlass, null));

    // Left & right silver/black roof luggage rails
    for (const sx of [-0.56, 0.56]) {
      const rail = new THREE.BoxGeometry(0.05, 0.045, 2.15);
      rail.translate(sx, 1.71, 0.42);
      body.get('trim').push(cleanGeom(rail, null));
    }
  }

  for (const wn of wheelNodes) {
    const m = new THREE.Matrix4().multiplyMatrices(FLIP, wn.matrixWorld);
    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    m.decompose(pos, quat, scl);
    if (type === 'suv') {
      pos.x *= 1.04;
      pos.z *= 0.98;
    }
    slots.push({ name: wn.name, pos, quat, front: /F[LR]$/.test(wn.name) });
    wheelRadius = pos.y;
  }
  const merge = (map) => {
    const out = [];
    for (const [mat, list] of map) {
      const g = list.length === 1 ? list[0] : mergeGeometries(ensureIndexed(list), false);
      if (!g) continue;
      g.computeBoundingSphere();
      out.push({ mat, geom: g });
    }
    return out;
  };
  const parts = merge(body);
  const box = new THREE.Box3();
  for (const p of parts) { p.geom.computeBoundingBox(); box.union(p.geom.boundingBox); }
  return { parts, wheel: merge(wheelGeo), slots, wheelRadius, box };
}

export async function loadModels(ctx) {
  const models = {};
  await Promise.all(TYPES.map(async (type) => {
    if (type === 'av') {
      models.av = buildDroneModel();
      return;
    }
    // `sedan` and `suv` reuse the `taxi` base GLB with civilian styling / SUV roof & proportions
    const glbBase = (type === 'sedan' || type === 'suv') ? 'taxi' : type;
    const lods = await Promise.all(LOD_SUFFIX.map((s) => ctx.assets.gltf(`models/vehicles/${glbBase}${s}.glb`)));
    const data = lods.map((g) => (g ? extract(g, type) : null));
    for (let i = 1; i < data.length; i++) if (!data[i]) data[i] = data[i - 1];
    if (!data[0]) { console.warn('[vehicles] missing model', type); return; }
    const box = data[0].box;
    const size = box.getSize(new THREE.Vector3());
    models[type] = {
      type, lods: data, slots: data[0].slots, wheelRadius: data[0].wheelRadius, box, size,
      length: size.z, width: size.x, height: size.y,
      axleF: data[0].slots.find((s) => s.front)?.pos.z ?? -size.z * 0.3,
      axleR: data[0].slots.find((s) => !s.front)?.pos.z ?? size.z * 0.3,
    };
  }));
  return models;
}
