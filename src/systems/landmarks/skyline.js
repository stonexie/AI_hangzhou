import * as THREE from 'three/webgpu';
import {
  positionWorld, normalWorld, vec2, vec3, vec4, float, mix, smoothstep, step, abs, fract, floor, hash, max, min, clamp,
  fwidth, sin, time, cameraPosition, instancedBufferAttribute, attribute, normalize, dot, uv, select, mx_noise_float, texture, pow,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './util.js';
import { U } from './materials.js';

// ---- unit tower geometries (footprint 1x1 centred, y 0..1), each with 'edge' attribute (0..1 across a facade) ----
function withEdge(g, mult = 1, round = 0, neon = 1) {
  g = g.index ? g.toNonIndexed() : g;
  if (!round) g.computeVertexNormals();
  g.setAttribute('round', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(round), 1));
  const uvA = g.attributes.uv, n = g.attributes.normal;
  const e = new Float32Array(uvA.count);
  for (let i = 0; i < uvA.count; i++) {
    e[i] = Math.abs(n.getY(i)) > 0.7 ? 0.5 : (uvA.getX(i) * mult) % 1.0000001;
  }
  // fix wrap at seam for cylinder-type (u*mult reaching exactly an integer)
  for (let i = 0; i < uvA.count; i += 3) {
    const a = uvA.getX(i) * mult, b = uvA.getX(i + 1) * mult, c = uvA.getX(i + 2) * mult;
    const base = Math.floor(Math.min(a, b, c) + 1e-4);
    if (Math.abs(n.getY(i)) <= 0.7) for (let k = 0; k < 3; k++) e[i + k] = (uvA.getX(i + k) * mult) - base;
  }
  g.setAttribute('edge', new THREE.BufferAttribute(e, 1));
  g.setAttribute('neonOK', new THREE.BufferAttribute(new Float32Array(uvA.count).fill(neon), 1));
  return g;
}
function boxAt(w, h, d, y0) { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, y0 + h / 2, 0); return withEdge(g); }
function towerGeos() {
  const geos = {};
  geos.box = boxAt(1, 1, 1, 0);
  geos.stepped = mergeGeometries([boxAt(1, 0.56, 1, 0), boxAt(0.8, 0.28, 0.8, 0.56), boxAt(0.58, 0.16, 0.58, 0.84)]);
  geos.stepped2 = mergeGeometries([boxAt(1, 0.7, 0.75, 0), boxAt(0.7, 0.3, 1.0, 0.0), boxAt(0.6, 0.3, 0.55, 0.7)]);
  {
    const g = new THREE.CylinderGeometry(0.36, 0.7071, 1, 4, 1); g.rotateY(Math.PI / 4); g.translate(0, 0.5, 0);
    geos.taper = withEdge(g, 4, 0, 0);
  }
  { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 20, 1); g.translate(0, 0.5, 0); geos.cyl = withEdge(g, 6, 1); }
  {
    const g = new THREE.BoxGeometry(1, 1, 1, 1, 18, 1); g.translate(0, 0.5, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i), a = y * 1.1, s = 1 - 0.25 * y;
      const x = p.getX(i) * s, z = p.getZ(i) * s;
      p.setXYZ(i, x * Math.cos(a) - z * Math.sin(a), y, x * Math.sin(a) + z * Math.cos(a));
    }
    g.computeVertexNormals();
    geos.twist = withEdge(g, 1, 0, 0);
  }
  {
    // chamfered octagon prism with crown
    const g1 = new THREE.CylinderGeometry(0.5, 0.5, 0.9, 8, 1); g1.rotateY(Math.PI / 8); g1.translate(0, 0.45, 0);
    const g2 = new THREE.CylinderGeometry(0.25, 0.42, 0.1, 8, 1); g2.rotateY(Math.PI / 8); g2.translate(0, 0.95, 0);
    geos.oct = mergeGeometries([withEdge(g1, 8), withEdge(g2, 8)]);
  }
  return geos;
}

const PALETTE_WIN = [[1.0, 0.78, 0.5], [1.0, 0.86, 0.66], [0.75, 0.88, 1.0], [0.6, 0.95, 1.0], [1.0, 0.95, 0.85], [0.9, 0.55, 1.0]];
const NEON = [[1.0, 0.1, 0.55], [0.1, 0.85, 1.0], [1.0, 0.5, 0.1], [0.7, 0.2, 1.0], [0.2, 1.0, 0.6], [1.0, 0.2, 0.15]];

function towerMaterial() {
  const m = new THREE.MeshStandardNodeMaterial();
  const a = attribute('aInfo', 'vec4'); // seed, height, style, neonIdx
  const b2 = attribute('aInfo2', 'vec4'); // neon r,g,b, crown flag
  const seed = a.x, hgt = a.y, style = a.z;
  const pw = positionWorld;
  const nW = normalize(normalWorld);
  const isRoof = smoothstep(0.6, 0.8, abs(nW.y));
  const tdir = normalize(vec3(nW.z, 0.0, nW.x.negate()).add(vec3(1e-4, 0, 0)));
  const a3 = attribute('aInfo3', 'vec4'); // centre x,z, radius, brightness
  const rel = pw.xz.sub(a3.xy);
  const rnd = attribute('round', 'float');
  const ang = rel.y.atan(rel.x);
  const u = mix(dot(rel, tdir.xz), ang.mul(a3.z), rnd);
  const camD = pw.sub(cameraPosition).length();
  const farDim = mix(float(1), float(0.22), smoothstep(250, 1400, camD));
  const v = pw.y;
  const h1 = hash(seed.add(1.3)), h2 = hash(seed.add(7.1)), h3 = hash(seed.add(13.7));
  const isRib = step(style, 0.5);                    // 0: ribbon curtain wall offices
  const isRes = step(1.5, style).mul(step(style, 2.5)); // 2: residential
  const isDark = step(2.5, style).mul(step(style, 3.5)); // 3: dark glass, sparse lights, neon edges
  const isPodium = step(3.5, style);
  const cw = mix(mix(float(1.9), float(2.7), h1), mix(float(1.3), float(1.8), h1), max(isRib, isRes)).mul(mix(float(1), float(0.75), smoothstep(150, 350, hgt)));
  const fh = mix(mix(float(3.6), float(4.2), h2), mix(float(2.9), float(3.2), h2), isRes);
  const gc = vec2(u.div(cw), v.div(fh));
  const cell = floor(gc);
  const f = fract(gc);
  const fw = fwidth(gc);
  const aa = clamp(max(fw.x, fw.y).mul(3.0).sub(0.3), 0, 1);
  const wx = mix(mix(float(0.16), float(0.26), h3), float(0.035), isRib);
  const wyb = mix(float(0.22), float(0.3), isRib), wyt = mix(float(0.14), float(0.08), isRib);
  const winSharp = smoothstep(wx, wx.add(0.03), f.x).mul(smoothstep(wx, wx.add(0.03), f.x.oneMinus()))
    .mul(smoothstep(wyb, wyb.add(0.03), f.y)).mul(smoothstep(wyt, wyt.add(0.03), f.y.oneMinus()));
  const cover = mix(float(0.36), float(0.6), isRib);
  const win = mix(winSharp, cover, aa);
  // rooms: ribbon offices light in multi-bay groups, others per window
  const roomN = mix(float(1), floor(mix(float(1), float(2.99), h3)), isRib);
  const room = floor(cell.x.div(roomN));
  const hc = hash(room.mul(17.31).add(cell.y.mul(113.7)).add(seed.mul(3.17)));
  const hf = hash(cell.y.mul(7.77).add(seed.mul(1.91)));
  // floor states: dark floors, fully lit floors, mixed floors; colour coherent per floor (reads as real offices, not noise)
  const occ = mix(mix(float(0.3), float(0.6), h2), float(0.88), isDark);
  const floorDark = step(mix(float(0.8), float(0.6), isDark), hf);
  const floorLit = step(hf, mix(float(0.12), float(0.0), isDark));
  const lit = mix(float(0.1), float(1), clamp(step(occ, hc).add(floorLit), 0, 1).mul(floorDark.oneMinus()));
  const hfl = hash(cell.y.mul(3.71).add(seed.mul(7.3)));
  const pi = floor(hash(room.mul(3.1).add(cell.y.mul(5.3)).add(seed)).mul(9.99));
  const warm = vec3(1.0, 0.72, 0.42), neutral = vec3(1.0, 0.88, 0.72), cool = vec3(0.7, 0.86, 1.0), cyanish = vec3(0.45, 0.9, 1.0);
  const towerTone = mix(mix(warm, cool, step(0.5, h1)), neutral, step(0.75, h3));
  const floorTone = mix(towerTone, mix(neutral, warm, step(0.5, h1)), step(0.7, hfl));
  let wc = mix(floorTone, mix(warm, cyanish, step(0.5, hc)), step(9.0, pi));
  wc = mix(wc, vec3(0.5, 0.35, 1.0), step(8.0, pi).mul(step(pi, 8.99)).mul(isRes)); // TV glow
  const inten = mix(float(0.5), float(1.2), hfl).mul(mix(float(0.7), float(1.0), hash(hc.mul(9.1).add(cell.x)))).mul(mix(float(1), float(0.75), isRib)).mul(mix(float(1.1), float(0.8), f.y));
  // per-window interior variation: blinds lowered to a random height, ceiling light strip, occasional dim curtain
  const hb = hash(cell.x.mul(41.7).add(cell.y.mul(9.13)).add(seed));
  const blindLvl = mix(float(0.35), float(1.1), hb);
  const gy = f.y.sub(wyb).div(float(1).sub(wyb).sub(wyt));
  const blind = mix(float(1), float(0.22), step(blindLvl, gy));
  const ceilL = smoothstep(0.78, 0.9, gy).mul(0.7).mul(aa.oneMinus());
  const mullR = smoothstep(0.03, 0.0, abs(fract(gc.x.mul(2)).sub(0.5))).mul(isRib).mul(aa.oneMinus());
  const varW = mix(blind, float(0.6), aa).add(ceilL).mul(float(1).sub(mullR.mul(0.8)));
  let emis = wc.mul(win).mul(lit).mul(inten).mul(varW);
  const bandCol = vec3(b2.x, b2.y, b2.z);
  // residential balcony slab edge: faint warm line; dark style: vertical fin pinstripes catching neon
  const slab = smoothstep(0.05, 0.0, abs(f.y.sub(0.04))).mul(mix(float(1), float(0.3), aa)).mul(isRes);
  emis = emis.add(vec3(1.0, 0.8, 0.6).mul(slab).mul(0.25));
  const fin = smoothstep(0.04, 0.0, abs(fract(u.div(1.2)).sub(0.5))).mul(isDark).mul(aa.oneMinus());
  emis = emis.add(bandCol.mul(fin).mul(0.15));
  // podium: bright shopfront band at the base
  const shopSeg = fract(u.div(7.0));
  const shop = smoothstep(4.6, 4.3, v).mul(smoothstep(0.6, 0.9, v)).mul(isPodium).mul(smoothstep(0.04, 0.1, shopSeg)).mul(smoothstep(0.96, 0.9, shopSeg)).mul(step(0.3, hash(floor(u.div(7.0)).add(seed.mul(5.0)))));
  const shopCol = mix(vec3(1.0, 0.85, 0.6), bandCol, step(0.5, hash(floor(u.div(6)).add(seed))));
  emis = emis.add(shopCol.mul(shop).mul(1.6));
  // vertical neon edge strips
  const e = attribute('edge', 'float');
  const edgeD = min(e, e.oneMinus());
  const hasNeon = isDark.mul(step(0.45, h3)).mul(isRoof.oneMinus()).mul(attribute('neonOK', 'float'));
  const strip = smoothstep(0.03, 0.012, edgeD).mul(hasNeon).mul(smoothstep(hgt.mul(0.5), hgt.mul(0.52), v)).mul(smoothstep(hgt.mul(0.97), hgt.mul(0.95), v));
  emis = emis.add(bandCol.mul(strip).mul(1.1));
  // crown light band near top
  const crown = smoothstep(hgt.sub(5.0), hgt.sub(4.0), v).mul(smoothstep(hgt.sub(1.0), hgt.sub(2.0), v)).mul(b2.w).mul(isRoof.oneMinus());
  emis = emis.add(bandCol.mul(crown).mul(1.4));
  emis = emis.mul(isRoof.oneMinus()).mul(farDim).mul(a3.w);
  // base: dark glass / panels
  const mull = smoothstep(0.03, 0.0, min(f.x, f.x.oneMinus())).mul(aa.oneMinus());
  const glass = vec3(0.025, 0.03, 0.04).mul(mx_noise_float(pw.mul(0.02)).mul(0.3).add(1.0));
  m.colorNode = mix(mix(glass, vec3(0.06, 0.06, 0.065), mull), vec3(0.03), isRoof);
  m.roughnessNode = mix(float(0.18), float(0.6), isRoof);
  m.metalnessNode = mix(float(0.6), float(0.0), isRoof);
  m.emissiveNode = emis;
  return m;
}

export function buildSkyline(ctx, tex, root) {
  const S = ctx.layout.skyline;
  const R = ctx.layout.river;
  const rng = mulberry32(90210);
  const towers = [];
  const geoNames = ['box', 'stepped', 'stepped2', 'taper', 'cyl', 'twist', 'oct'];
  const rail = ctx.layout.elevatedRail, exw = ctx.layout.expressway;
  const blocked = (x, z, r) => {
    // district (other systems), river, corridors of rail/expressway, bridge
    if (x > -215 - r && x < 148 + r && z > -440 - r && z < 75 + r) return true;
    if (x > R.xCenter - R.halfWidth - 8 - r && x < R.xCenter + R.halfWidth + 10 + r) return true;
    if (Math.abs(z - rail.z) < 10 + r) return true;
    if (Math.abs(z - exw.z) < 14 + r) return true;
    if (Math.abs(z - ctx.layout.bridges[0].z) < 14 + r && x < 270) return true;
    for (const t of towers) { const dx = t.x - x, dz = t.z - z; if (dx * dx + dz * dz < (t.r + r + 6) ** 2) return false || true; }
    return false;
  };
  const add = (x, z, w, d, h, type, style, opts = {}) => {
    towers.push({ x, z, w, d, h, type, style, r: Math.max(w, d) * 0.6, rot: opts.rot ?? (rng() < 0.7 ? 0 : rng() * Math.PI), neon: opts.neon ?? Math.floor(rng() * NEON.length), crown: opts.crown ?? (rng() < 0.25 ? 1 : 0), spire: opts.spire ?? (rng() < 0.4), seed: rng() * 100, bright: opts.bright ?? (0.35 + rng() * 0.8) });
  };
  // hero towers (fixed, art-directed for the river & overlook views)
  add(268, -330, 46, 40, 300, 'stepped', 0, { rot: 0, neon: 0, crown: 1, spire: true });
  add(330, -470, 40, 40, 360, 'taper', 1, { rot: 0.2, neon: 1, crown: 1, spire: true });
  add(255, -120, 34, 30, 170, 'box', 3, { rot: 0, neon: 3, crown: 0, spire: false });
  add(300, -40, 38, 32, 210, 'oct', 0, { rot: 0, neon: 2, crown: 1, spire: true });
  add(250, 40, 30, 30, 120, 'box', 2, { rot: 0, neon: 4 });
  add(380, -250, 44, 44, 420, 'twist', 1, { rot: 0.4, neon: 1, crown: 1, spire: true });
  add(60, -620, 50, 46, 480, 'stepped', 0, { rot: 0, neon: 0, crown: 1, spire: true });
  add(-120, -560, 40, 40, 330, 'cyl', 3, { neon: 1, crown: 1, spire: true });
  add(180, -760, 44, 44, 440, 'taper', 1, { neon: 5, crown: 1, spire: true });
  // far bank cluster
  for (let i = 0; i < 400 && towers.length < 70; i++) {
    const x = 240 + rng() * 220, z = 120 - rng() * 920;
    const w = 18 + rng() * 26, d = 18 + rng() * 22;
    if (blocked(x, z, Math.max(w, d) * 0.6)) continue;
    const near = x < 300;
    const h = near ? 40 + rng() * 120 : 70 + rng() * 220;
    add(x, z, w, d, h, geoNames[Math.floor(rng() * geoNames.length)], Math.floor(rng() * 4));
    if (near && rng() < 0.6) add(x, z, w * 1.5, d * 1.4, 10 + rng() * 8, 'box', 4, { rot: towers[towers.length - 1].rot, spire: false, crown: 0 });
  }
  // north and west mid-ring
  for (let i = 0; i < 600 && towers.length < 130; i++) {
    const x = -450 + rng() * 900, z = -440 - rng() * 500;
    const w = 20 + rng() * 30, d = 20 + rng() * 30;
    if (blocked(x, z, Math.max(w, d) * 0.6)) continue;
    const dd = -z - 440;
    add(x, z, w * 0.85, d * 0.85, 30 + rng() * Math.min(280, 30 + dd * 0.55), geoNames[Math.floor(rng() * geoNames.length)], Math.floor(rng() * 4));
  }
  for (let i = 0; i < 400 && towers.length < 185; i++) {
    const x = -230 - rng() * 250, z = 150 - rng() * 600;
    const w = 20 + rng() * 26, d = 20 + rng() * 26;
    if (blocked(x, z, Math.max(w, d) * 0.6)) continue;
    add(x, z, w, d, 40 + rng() * 160, geoNames[Math.floor(rng() * geoNames.length)], Math.floor(rng() * 4));
  }
  // outer ring of megatowers
  let placed = 0;
  for (let i = 0; i < 3000 && placed < S.count; i++) {
    let ang = rng() * Math.PI * 2;
    // bias toward north/east (where the views look)
    if (rng() < 0.55) ang = -Math.PI * 0.5 + (rng() - 0.5) * Math.PI * 1.1; // around -z
    const rad = S.innerRadius + Math.pow(rng(), 0.8) * (S.outerRadius - S.innerRadius);
    const x = Math.cos(ang) * rad + 100, z = Math.sin(ang) * rad - 150;
    const w = 30 + rng() * 50, d = 30 + rng() * 50;
    if (blocked(x, z, Math.max(w, d) * 0.6)) continue;
    const hh = S.megaTowerHeight[0] + Math.pow(rng(), 1.5) * (S.megaTowerHeight[1] - S.megaTowerHeight[0]);
    add(x, z, w, d, hh, geoNames[Math.floor(rng() * geoNames.length)], Math.floor(rng() * 4));
    placed++;
  }

  // ---- build instanced meshes per geometry type ----
  const geos = towerGeos();
  const mat = towerMaterial();
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  for (const name of Object.keys(geos)) {
    const list = towers.filter((t) => t.type === name);
    if (!list.length) continue;
    const g = geos[name].clone();
    const info = new Float32Array(list.length * 4), info2 = new Float32Array(list.length * 4), info3 = new Float32Array(list.length * 4);
    const mesh = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((t, i) => {
      q.setFromAxisAngle(yAxis, t.rot); p.set(t.x, 0, t.z); s.set(t.w, t.h, t.d);
      m4.compose(p, q, s); mesh.setMatrixAt(i, m4);
      const nc = NEON[t.neon];
      info.set([t.seed, t.h, t.style, t.neon], i * 4);
      info2.set([nc[0], nc[1], nc[2], t.crown], i * 4);
      info3.set([t.x, t.z, (t.w + t.d) / 4, t.bright], i * 4);
    });
    g.setAttribute('aInfo', new THREE.InstancedBufferAttribute(info, 4));
    g.setAttribute('aInfo2', new THREE.InstancedBufferAttribute(info2, 4));
    g.setAttribute('aInfo3', new THREE.InstancedBufferAttribute(info3, 4));
    mesh.computeBoundingSphere();
    mesh.name = 'skyline_' + name;
    root.add(mesh);
  }

  // ---- spires + aircraft warning lights ----
  const spireTowers = towers.filter((t) => t.spire);
  const spireGeo = new THREE.CylinderGeometry(0.25, 1.2, 1, 6); spireGeo.translate(0, 0.5, 0);
  const spireMat = new THREE.MeshStandardNodeMaterial({ color: 0x1a1a1e, roughness: 0.5, metalness: 0.8 });
  const spires = new THREE.InstancedMesh(spireGeo, spireMat, spireTowers.length);
  const beacons = [];
  const topFactor = { box: 1, stepped: 1, stepped2: 1, taper: 1, cyl: 1, twist: 1, oct: 1 };
  spireTowers.forEach((t, i) => {
    const sh = 20 + (t.seed % 1) * 50 + t.h * 0.08;
    p.set(t.x, t.h * topFactor[t.type], t.z); s.set(1, sh, 1); q.identity();
    m4.compose(p, q, s); spires.setMatrixAt(i, m4);
    beacons.push([t.x, t.h + sh, t.z, t.seed]);
  });
  root.add(spires);
  towers.forEach((t) => {
    // roof corner beacons
    if (t.h < 260 || t.spire) return;
    const hw = t.w * 0.35, hd = t.d * 0.35;
    const topScale = t.type === 'taper' ? 0.5 : t.type === 'stepped' ? 0.58 : t.type === 'twist' ? 0.75 : 1;
    const c = Math.cos(t.rot), sn = Math.sin(t.rot);
    for (const [ax, az] of [[-1, -1], [1, 1]]) {
      const lx = ax * hw * topScale, lz = az * hd * topScale;
      beacons.push([t.x + lx * c + lz * sn, t.h + 0.5, t.z - lx * sn + lz * c, t.seed + ax]);
    }
  });
  const bGeo = new THREE.OctahedronGeometry(1, 0);
  const bPhase = new Float32Array(beacons.length);
  const bMesh = new THREE.InstancedMesh(bGeo, null, beacons.length);
  beacons.forEach((bb, i) => {
    const d = Math.hypot(bb[0], bb[2]);
    const sc = 0.5 + d / 1100;
    p.set(bb[0], bb[1], bb[2]); s.set(sc, sc, sc); q.identity(); m4.compose(p, q, s); bMesh.setMatrixAt(i, m4);
    bPhase[i] = (bb[3] * 0.37) % 1;
  });
  bGeo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(bPhase, 1));
  const bMat = new THREE.MeshBasicNodeMaterial();
  const ph = attribute('aPhase', 'float');
  const blink = smoothstep(0.55, 0.6, fract(time.mul(0.75).add(ph))).mul(smoothstep(1.0, 0.9, fract(time.mul(0.75).add(ph))));
  bMat.colorNode = vec3(1.0, 0.02, 0.01).mul(mix(float(0.6), float(30), blink));
  bMat.fog = false;
  bMesh.material = bMat;
  root.add(bMesh);

  // ---- holographic ads + logos ----
  buildHolos(ctx, tex, root, towers);
  return { towers };
}

function holoMaterial(map, rect, intensity = 3, opts = {}) {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const u = uv();
  const tuv = vec2(mix(float(rect[0]), float(rect[2]), u.x), mix(float(rect[1]), float(rect[3]), u.y));
  const c = texture(map, tuv).rgb;
  const scan = sin(u.y.mul(opts.lines ?? 380).add(time.mul(3))).mul(0.12).add(0.88);
  const seed = opts.seed ?? 0;
  const flick = mix(float(1), step(0.04, fract(sin(floor(time.mul(14)).add(seed)).mul(43758.5))), float(opts.flicker ?? 0.6));
  const glitchBand = step(0.985, fract(u.y.mul(3).add(time.mul(0.35).add(seed)))).mul(0.6);
  const lum = max(c.r, max(c.g, c.b));
  m.colorNode = c.mul(intensity).mul(scan).mul(flick).add(c.mul(glitchBand).mul(intensity));
  m.opacityNode = clamp(lum.mul(1.5), 0, 1);
  return m;
}

function buildHolos(ctx, tex, root, towers) {
  if (!tex.ads) return;
  const R = ctx.layout.river;
  // atlas 1: 4 vertical panels (u: 0-.25 anime woman, .25-.5 KAZE TECH, .5-.75 MIRAI, .75-1 geisha)
  // texture v=1 is top of image
  const panel = (i) => [i * 0.25 + 0.004, 0.0, (i + 1) * 0.25 - 0.004, 1.0];
  const place = (map, rect, w, h, x, y, z, ry, intensity, seed) => {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), holoMaterial(map, rect, intensity, { seed }));
    mesh.position.set(x, y, z); mesh.rotation.y = ry; mesh.renderOrder = 5;
    root.add(mesh);
    return mesh;
  };
  const faceWest = -Math.PI / 2; // plane normal +z rotated to -x
  // hero MIRAI tower (268,-330), front face at x = 268 - 23 = 245, facing west towards promenade
  place(tex.ads, panel(2), 36, 72, 244.2, 110, -330, faceWest, 4.0, 1);
  // KAZE TECH vertical on (255,-120) facade x = 238
  place(tex.ads, panel(1), 18, 36, 237.6, 110, -120, faceWest, 3.5, 2);
  // anime woman on (300,-40) octagon, facing west
  place(tex.ads3 || tex.ads, panel(3), 22, 44, 280.5, 140, -40, faceWest, 3.2, 3);
  // geisha on the twisted tower region (visible from overlook), facing south-west
  place(tex.ads, panel(3), 26, 52, 352, 180, -230, -Math.PI * 0.35, 3.2, 4);
  // MIRAI also facing the overlook / district (south face of tall taper)
  place(tex.ads, panel(2), 24, 48, 330, 230, -449, 0, 4.0, 5);
  place(tex.ads3 || tex.ads, panel(0), 30, 60, 60, 300, -596, 0, 3.5, 6);
  place(tex.ads3 || tex.ads, panel(2), 26, 52, -120, 220, -539, 0.3, 3.0, 7);
  // procedural placement: big vertical ads on south faces of tall unrotated towers north/east of the district
  const cand = towers.filter((t) => t.rot === 0 && t.h > 170 && t.z < -420 && t.x > -250 && (t.type === 'box' || t.type === 'stepped' || t.type === 'stepped2'));
  cand.slice(0, 18).forEach((t, i) => {
    const w = Math.min(t.w * 0.7, 46), h = w * 2;
    const top = t.type === 'stepped' ? t.h * 0.56 : t.type === 'stepped2' ? t.h * 0.7 : t.h;
    const y = Math.min(top - h * 0.6, t.h * 0.45 + h * 0.5);
    const zf = t.z + (t.type === 'stepped2' ? t.d * 0.5 : t.d / 2) + 0.6;
    if (i % 3 === 2 && tex.ads2) place(tex.ads2, i % 2 ? [0, 0.5, 1, 1] : [0, 0, 1, 0.5], w * 1.6, w * 0.4, t.x, y, zf, 0, 3.0, 20 + i);
    else { const pool = [[tex.ads3, 0], [tex.ads, 3], [tex.ads3, 1], [tex.ads, 0], [tex.ads3, 2], [tex.ads, 1], [tex.ads3, 3], [tex.ads, 2]].filter((p) => p[0]); const pk = pool[i % pool.length]; place(pk[0], panel(pk[1]), w, h, t.x, y, zf, 0, 3.4, 20 + i); }
  });
  if (tex.ads2) {
    // wide horizontal ads (top: OKAMI MOTORS, bottom: HANAMI RAMEN), texture v: top half = 0.5..1
    place(tex.ads2, [0, 0.5, 1, 1], 48, 12, 244.5, 40, -330, faceWest, 3.0, 8);
    place(tex.ads2, [0, 0.0, 1, 0.5], 40, 10, 237.6, 60, -120, faceWest, 3.0, 9);
    place(tex.ads2, [0, 0.5, 1, 1], 60, 15, 180, 320, -738, 0, 3.0, 10);
  }
}
