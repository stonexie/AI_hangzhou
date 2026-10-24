// Street furniture lighting: street lamps, traffic + pedestrian signals (animated), P parking sign, road signs,
// alley utility poles with lamps. Static parts are merged into the shared housing batch; lenses into the face batch.
import * as THREE from 'three/webgpu';
import { attribute, uniform, float, vec3, vec2, texture, uv, select, step, fract, floor, mix } from 'three/tsl';
import { uTime } from './materials.js';
import { alleyGroundY } from './facades.js';
import { nearestFacade, makeFacade } from './featured.js';

const UP = new THREE.Vector3(0, 1, 0);

function parts(gltf) {
  // name -> array of meshes (multi-material nodes load as Group with child meshes)
  const out = {};
  if (!gltf) return out;
  gltf.scene.updateMatrixWorld(true);
  for (const top of gltf.scene.children) {
    const list = [];
    top.traverse((o) => { if (o.isMesh) list.push(o); });
    if (list.length) out[top.name] = list;
  }
  return out;
}
const each = (list, fn) => { for (const m of list || []) fn(m.geometry, m.matrixWorld); };

// traffic cycle: 0..20s. phase 0 = avenue (N/S), phase 1 = cross street (E/W)
const CYCLE = 22;
function sigState(phase, t) {
  const c = ((t + 3) % CYCLE + CYCLE) % CYCLE;
  const local = phase === 0 ? c : (c + CYCLE / 2) % CYCLE;
  // 0-8 green, 8-10.5 yellow, 10.5-22 red (incl. all-red)
  if (local < 8) return 0; if (local < 10.5) return 1; return 2;
}
function pedState(phase, t) { // 0 walk, 1 blink, 2 stop
  const c = ((t + 3) % CYCLE + CYCLE) % CYCLE;
  const local = phase === 0 ? c : (c + CYCLE / 2) % CYCLE;
  if (local < 6) return 0; if (local < 8) return (Math.floor(local * 4) % 2 ? 1 : 0); return 2;
}

export async function buildStreet(ctx, sb, L) {
  const { assets, layout, scene } = ctx;
  const [gL, gT, gP, gU] = await Promise.all(['streetlamp', 'traffic_signal', 'ped_signal', 'utility_pole'].map((n) => assets.gltf(`models/signage/${n}.glb`)));
  const SL = parts(gL), TS = parts(gT), PS = parts(gP), UP_ = parts(gU);
  const groundY = (x, z) => { try { const h = ctx.api.ground?.heightAt?.(x, z); return Number.isFinite(h) ? h : null; } catch { return null; } };
  const physics = ctx.physics;
  const collider = (x, y, z, hh, r) => { if (physics?.RAPIER) physics.world.createCollider(physics.RAPIER.ColliderDesc.cylinder(hh, r).setTranslation(x, y + hh, z)); };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  const metal = { col: [0.38, 0.39, 0.4], mr: [0.85, 0.38] };
  const av = layout.avenue, cs = layout.crossStreets;
  const sideY = av.curbHeight;

  // ---------- street lamps
  const lampAt = (x, z, yaw, warm) => {
    if (!SL.body) return;
    const y = groundY(x, z) ?? sideY;
    m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), one);
    each(SL.body, (g, mw) => sb.H.geometry(g, m4.clone().multiply(mw), metal));
    const col = warm ? [1.0, 0.62, 0.3] : [0.85, 0.92, 1.0];
    each(SL.lens, (g, mw) => sb.F.geometry(g, m4.clone().multiply(mw), { tint: col, sp: [2, 9, 0, 0], back: [0, 0, 0] }));
    const lp = new THREE.Vector3(2.2, 7.75, 0).applyAxisAngle(UP, yaw).add(new THREE.Vector3(x, y, z));
    sb.light(lp, col, 55, 22, 0, 0, 1.4);
    collider(x, y, z, 4, 0.13);
  };
  const nearCross = (z, pad) => cs.zs.some((c) => Math.abs(z - c) < cs.roadHalfWidth + cs.sidewalkWidth + pad);
  let k = 0;
  for (let z = av.zStart - 6; z > av.zEnd + 5; z -= 26) {
    if (nearCross(z, 3)) continue;
    const warm = (k++ % 5) !== 3;
    lampAt(-(av.roadHalfWidth + 0.55), z, 0, warm);
    lampAt(av.roadHalfWidth + 0.55, z - 13, Math.PI, warm);
  }
  for (const zc of cs.zs) {
    for (let x = cs.xStart + 10; x < cs.xEnd - 5; x += 28) {
      if (Math.abs(x) < av.roadHalfWidth + av.sidewalkWidth + 4) continue;
      lampAt(x, zc - (cs.roadHalfWidth + 0.5), -Math.PI / 2, true);
      lampAt(x + 14, zc + (cs.roadHalfWidth + 0.5), Math.PI / 2, true);
    }
  }

  // ---------- traffic + pedestrian signals
  const sig = { pos: [], nor: [], sig: [], uv: [], idx: [] };
  const sigCands = [];
  const addLens = (geom, mat, phase, lamp, uvFn) => {
    const P = geom.attributes.position, N = geom.attributes.normal;
    const base = sig.pos.length / 3;
    const nm = new THREE.Matrix3().getNormalMatrix(mat);
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    geom.computeBoundingBox();
    const bb = geom.boundingBox;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i);
      const lu = (v.x - bb.min.x) / (bb.max.x - bb.min.x + 1e-6), lv = (v.y - bb.min.y) / (bb.max.y - bb.min.y + 1e-6);
      v.applyMatrix4(mat); n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      sig.pos.push(v.x, v.y, v.z); sig.nor.push(n.x, n.y, n.z); sig.sig.push(phase, lamp);
      const uvv = uvFn ? uvFn(lu, lv) : [0, 0]; sig.uv.push(uvv[0], uvv[1]);
    }
    const I = geom.index;
    if (I) for (let i = 0; i < I.count; i++) sig.idx.push(base + I.getX(i)); else for (let i = 0; i < P.count; i++) sig.idx.push(base + i);
  };
  const signalAt = (x, z, yaw, phase) => {
    if (!TS.body) return;
    const y = groundY(x, z) ?? sideY;
    m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), one);
    each(TS.body, (g, mw) => sb.H.geometry(g, m4.clone().multiply(mw), { col: [0.42, 0.43, 0.43], mr: [0.8, 0.42] }));
    ['lensG', 'lensY', 'lensR'].forEach((nm, i) => each(TS[nm], (g, mw) => addLens(g, m4.clone().multiply(mw), phase, i)));
    const hp = new THREE.Vector3(4.0, 5.2, 0).applyAxisAngle(UP, yaw).add(new THREE.Vector3(x, y, z));
    const c = { pos: hp, color: [0, 1, 0.6], intensity: 10, distance: 13, importance: 2, phase, kind: 'sig' };
    sigCands.push(sb.pool.add(c));
    collider(x, y, z, 3, 0.14);
  };
  const pedAt = (x, z, yaw, phase) => {
    if (!PS.body) return;
    const y = groundY(x, z) ?? sideY;
    m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), one);
    each(PS.body, (g, mw) => sb.H.geometry(g, m4.clone().multiply(mw), { col: [0.42, 0.43, 0.43], mr: [0.8, 0.42] }));
    const R = L.misc.pedR.rect.uv, G = L.misc.pedG.rect.uv;
    each(PS.pedR, (g, mw) => addLens(g, m4.clone().multiply(mw), phase, 3, (u, v) => [R[0] + (R[2] - R[0]) * u, R[1] + (R[3] - R[1]) * v]));
    each(PS.pedG, (g, mw) => addLens(g, m4.clone().multiply(mw), phase, 4, (u, v) => [G[0] + (G[2] - G[0]) * u, G[1] + (G[3] - G[1]) * v]));
    collider(x, y, z, 1.5, 0.08);
  };
  const ex = av.roadHalfWidth + 0.6, ez = cs.roadHalfWidth + 0.6;
  for (const zc of cs.zs) {
    signalAt(-ex, zc - ez, 0, 0);          // faces north-bound traffic
    signalAt(ex, zc + ez, Math.PI, 0);     // south-bound
    signalAt(ex, zc - ez, -Math.PI / 2, 1); // arm over cross street
    signalAt(-ex, zc + ez, Math.PI / 2, 1);
    // pedestrian signals at crosswalk ends (crossing the cross street => phase 0; crossing the avenue => phase 1)
    pedAt(-ex - 1.2, zc + ez + 0.4, 0, 0); pedAt(-ex - 1.2, zc - ez - 0.4, Math.PI, 0);
    pedAt(ex + 1.2, zc + ez + 0.4, 0, 0); pedAt(ex + 1.2, zc - ez - 0.4, Math.PI, 0);
    pedAt(-ex - 0.4, zc + ez + 1.4, Math.PI / 2, 1); pedAt(ex + 0.4, zc + ez + 1.4, -Math.PI / 2, 1);
    pedAt(-ex - 0.4, zc - ez - 1.4, Math.PI / 2, 1); pedAt(ex + 0.4, zc - ez - 1.4, -Math.PI / 2, 1);
  }
  const uSig = [uniform(0), uniform(2), uniform(0), uniform(2)]; // [avenue car, cross car, avenue ped, cross ped]
  if (sig.idx.length) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(sig.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(sig.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(sig.uv, 2));
    g.setAttribute('sig', new THREE.Float32BufferAttribute(sig.sig, 2));
    g.setIndex(sig.idx);
    const mat = new THREE.MeshStandardNodeMaterial();
    const a = attribute('sig', 'vec2');
    const phase = a.x, lamp = a.y;
    const isPed = lamp.greaterThan(2.5);
    const carState = select(phase.lessThan(0.5), uSig[0], uSig[1]);
    const pedSt = select(phase.lessThan(0.5), uSig[2], uSig[3]);
    const carOn = select(lamp.lessThan(0.5), carState.lessThan(0.5), select(lamp.lessThan(1.5), carState.greaterThan(0.5).and(carState.lessThan(1.5)), carState.greaterThan(1.5)));
    const pedOn = select(lamp.lessThan(3.5), pedSt.greaterThan(1.5), pedSt.lessThan(0.5));
    const on = select(isPed, pedOn, carOn);
    const col = select(lamp.lessThan(0.5), vec3(0.05, 1.0, 0.55), select(lamp.lessThan(1.5), vec3(1.0, 0.55, 0.05), select(lamp.lessThan(2.5), vec3(1.0, 0.06, 0.03), vec3(1, 1, 1))));
    const cm = texture(sb.colorTex, uv());
    const icon = cm.rgb.mul(cm.rgb);
    const e = select(isPed, icon.mul(4.0), col.mul(7.0));
    mat.colorNode = select(isPed, icon.mul(0.05), col.mul(0.04));
    mat.emissiveNode = e.mul(select(on, float(1), float(0.02)));
    mat.roughnessNode = float(0.2);
    mat.metalnessNode = float(0);
    const mesh = new THREE.Mesh(g, mat); mesh.name = 'signals'; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    scene.add(mesh);
  }

  // ---------- P parking blade (ref panel 1, right side)
  const pF = nearestFacade(sb.facades || [], new THREE.Vector3(10, 0, -3), new THREE.Vector3(-1, 0, 0), 0.8) || makeFacade(new THREE.Vector3(av.x + layout.blocks.frontageOffset, 10, -3), new THREE.Vector3(-1, 0, 0), 4, 20);
  if (L.misc.parking) {
    const base = pF.center.y - pF.height / 2;
    sb.blade(pF, 0, base + 7.4, L.misc.parking, { depth: 1.2, thick: 0.35, maxH: 1.3, housing: [[0.6, 0.6, 0.62], [0.2, 0.4]], inten: 2.4, lightColor: [0.4, 0.6, 1], importance: 2 });
    sb.blade(pF, 0, base + 4.9, L.misc.parkingSub, { depth: 1.2, thick: 0.35, maxH: 2.4, housing: [[0.6, 0.6, 0.62], [0.2, 0.4]], inten: 2.0, importance: 1 });
  }

  // ---------- road signs on poles
  const roadSign = (x, z, yaw, design, size, h) => {
    if (!design) return;
    const y = groundY(x, z) ?? sideY;
    const n = new THREE.Vector3(0, 0, 1).applyAxisAngle(UP, yaw), r = new THREE.Vector3().crossVectors(UP, n);
    sb.bar(new THREE.Vector3(x, y, z), new THREE.Vector3(x, y + h + size * 0.4, z), 0.035, [0.6, 0.6, 0.6], [0.8, 0.4]);
    const c = new THREE.Vector3(x, y + h, z).addScaledVector(n, 0.05);
    sb.hbox(c.clone().addScaledVector(n, -0.01), [r, UP, n], [size / 2 * design.aspect, size / 2, 0.01], [0.5, 0.5, 0.5], [0.8, 0.4]);
    sb.F.quad(c.clone().addScaledVector(n, 0.002), r, UP, size / 2 * design.aspect, size / 2, n, design.rect.uv, { tint: [1, 1, 1], sp: [3, 0.05, 0, 0], back: [0, 0, 0] });
    collider(x, y, z, 1.2, 0.05);
  };
  for (const zc of cs.zs) {
    roadSign(-(av.roadHalfWidth + 0.5), zc + 12, 0, L.misc.stop, 0.8, 2.3);
    roadSign(av.roadHalfWidth + 0.5, zc + 18, 0, L.misc.speed, 0.6, 2.6);
    roadSign(-(av.roadHalfWidth + 0.5), zc + 22, 0, L.misc.crossing, 0.6, 2.6);
  }
  // blue direction sign over the sidewalk near the first intersection
  if (L.misc.direction) {
    const z = cs.zs[0] + 18, x = av.roadHalfWidth + 0.5;
    sb.bar(new THREE.Vector3(x, sideY, z), new THREE.Vector3(x, 6.4, z), 0.1, [0.5, 0.5, 0.5], [0.8, 0.4]);
    sb.bar(new THREE.Vector3(x, 6.2, z), new THREE.Vector3(x - 4.2, 6.2, z), 0.07, [0.5, 0.5, 0.5], [0.8, 0.4]);
    const c = new THREE.Vector3(x - 2.4, 5.4, z + 0.12);
    sb.hbox(c.clone().add(new THREE.Vector3(0, 0, -0.04)), [new THREE.Vector3(1, 0, 0), UP, new THREE.Vector3(0, 0, 1)], [1.6, 0.8, 0.03], [0.4, 0.4, 0.4], [0.8, 0.4]);
    sb.F.quad(c, new THREE.Vector3(1, 0, 0), UP, 1.6, 0.8, new THREE.Vector3(0, 0, 1), L.misc.direction.rect.uv, { tint: [1, 1, 1], sp: [3, 0.08, 0, 0], back: [0, 0, 0] });
    collider(x, 0, z, 3.2, 0.1);
  }

  // ---------- alley utility poles with lamps
  const al = layout.alley;
  if (UP_.body) {
    let i = 0;
    for (let x = al.xStart - 6; x > al.xEnd + 4; x -= 12) {
      const side = i++ % 2 ? 1 : -1;
      const z = al.z + side * (al.width / 2 - 0.35);
      const y = groundY(x, z) ?? alleyGroundY(layout, x);
      const yaw = side < 0 ? -Math.PI / 2 : Math.PI / 2; // lamp arm toward alley centre
      m4.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(UP, yaw), one);
      each(UP_.body, (g, mw) => sb.H.geometry(g, m4.clone().multiply(mw), { col: [0.36, 0.35, 0.33], mr: [0.0, 0.85] }));
      const warm = i % 3 !== 0;
      const col = warm ? [1.0, 0.7, 0.4] : [0.8, 0.95, 1.0];
      each(UP_.lens, (g, mw) => sb.F.geometry(g, m4.clone().multiply(mw), { tint: col, sp: [2, 8, 0, 0], back: [0, 0, 0] }));
      const lp = new THREE.Vector3(0.95, 4.5, 0).applyAxisAngle(UP, yaw).add(new THREE.Vector3(x, y, z));
      sb.light(lp, col, 14, 13, i * 7 % 997, i === 4 ? 1 : 0, 1.6);
      collider(x, y, z, 5, 0.17);
    }
  }

  const red = new THREE.Color(1, 0.06, 0.03), yel = new THREE.Color(1, 0.55, 0.05), grn = new THREE.Color(0.05, 1, 0.55);
  return {
    update(dt, t) {
      uSig[0].value = sigState(0, t); uSig[1].value = sigState(1, t);
      uSig[2].value = pedState(0, t); uSig[3].value = pedState(1, t);
      for (const c of sigCands) { const s = sigState(c.phase, t); c.color.copy(s === 0 ? grn : s === 1 ? yel : red); }
    },
  };
}
