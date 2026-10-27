// Vertex-animation-texture (VAT) instanced crowd for far LOD.
// At load we CPU-skin each outfit's decimated LOD1 mesh over a few clips into half-float textures
// (position + normal per vertex per frame). One instanced draw per outfit renders every far NPC wearing it;
// the vertex shader fetches + lerps two frames, applies per-instance yaw/scale/position.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, vertexIndex, int, ivec2, float, vec3, vec4, floor, mod, mix, cos, sin, textureLoad, normalLocal,
  clamp, normalWorld, uniform, max,
} from 'three/tsl';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CROWD_U } from './characters.js';

// far clips: name -> frames sampled per cycle
export const VAT_CLIPS = { walk: 16, cover_run: 16, umbrella_walk: 16, idle: 28, phone_idle: 20, umbrella_idle: 20 };
// map any runtime clip to a VAT clip
export const VAT_MAP = {
  walk: 'walk', walk_slow: 'walk', walk_fast: 'walk', cover_run: 'cover_run', phone_walk: 'walk', umbrella_walk: 'umbrella_walk',
  idle: 'idle', idle_b: 'idle', phone_idle: 'phone_idle', umbrella_idle: 'umbrella_idle',
  // procedural standing actions reuse the idle VAT cycle at distance
  yawn: 'idle', stretch: 'idle', look_around: 'idle', chat: 'idle', drink: 'idle', eat: 'idle',
  photo: 'phone_idle', wave_hello: 'idle', check_watch: 'idle', squat_pickup: 'idle', adjust_collar: 'idle',
};

function toHalf(v) { return THREE.DataUtils.toHalfFloat(v); }

export class VatOutfit {
  /**
   * lodGroup: Group/SkinnedMesh of the outfit LOD1 (from gltf, original, not cloned), clips: {name: AnimationClip}
   */
  constructor(lib, entry, outfit, maxInstances) {
    this.max = maxInstances;
    const lod = entry.lodTemplates[outfit];
    const meshes = [];
    lod.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
    if (!meshes.length) throw new Error('no lod meshes for ' + outfit);
    // merged geometry: position, normal, color (vertex colour baked in Blender, alpha = emissive mask), skin attrs
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'color', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
      if (!g.attributes.color) {
        const n = g.attributes.position.count; const c = new Float32Array(n * 4).fill(0.5); g.setAttribute('color', new THREE.BufferAttribute(c, 4));
      }
      if (g.attributes.color.itemSize === 3) {
        const src = g.attributes.color; const n = src.count; const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { c[i * 4] = src.getX(i); c[i * 4 + 1] = src.getY(i); c[i * 4 + 2] = src.getZ(i); c[i * 4 + 3] = 0; }
        g.setAttribute('color', new THREE.BufferAttribute(c, 4));
      } else if (!(g.attributes.color.array instanceof Float32Array)) {
        const src = g.attributes.color; const n = src.count; const c = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) { c[i * 4] = src.getX(i); c[i * 4 + 1] = src.getY(i); c[i * 4 + 2] = src.getZ(i); c[i * 4 + 3] = src.getW(i); }
        g.setAttribute('color', new THREE.BufferAttribute(c, 4));
      }
      if (g.attributes.skinIndex && !(g.attributes.skinIndex.array instanceof Uint8Array)) {
        const src = g.attributes.skinIndex; const n = src.count; const si = new Uint8Array(n * 4);
        for (let i = 0; i < n; i++) { si[i * 4] = src.getX(i); si[i * 4 + 1] = src.getY(i); si[i * 4 + 2] = src.getZ(i); si[i * 4 + 3] = src.getW(i); }
        g.setAttribute('skinIndex', new THREE.Uint8BufferAttribute(si, 4));
      }
      if (g.index && !(g.index.array instanceof Uint16Array)) {
        const src = g.index; const idx = new Uint16Array(src.count);
        for (let i = 0; i < src.count; i++) idx[i] = src.getX(i);
        g.setIndex(new THREE.Uint16BufferAttribute(idx, 1));
      }
      g.clearGroups();
      return g;
    });
    const geo = mergeGeometries(geos, false);
    const mesh0 = meshes[0];
    const skeleton = mesh0.skeleton;
    const nV = geo.attributes.position.count;
    this.nV = nV;
    // texture layout: width W (<= 4096), rowsPerFrame R
    const W = Math.min(4096, nV);
    const R = Math.ceil(nV / W);
    this.W = W; this.R = R;
    // bake
    const clipRows = {};
    let total = 0;
    for (const [name, nf] of Object.entries(VAT_CLIPS)) { if (entry.clips[name]) { clipRows[name] = { start: total, frames: nf }; total += nf; } }
    this.clipRows = clipRows;
    const H = total * R;
    const pos = new Uint16Array(W * H * 4);
    const nrm = new Uint16Array(W * H * 4);
    // bake rig: clone of the full lod hierarchy root so the mixer can drive bones
    const root = lod.parent ? findRoot(lod) : lod;
    const bakeRoot = root; // original gltf scene (not rendered)
    const mixer = new THREE.AnimationMixer(bakeRoot);
    const P = geo.attributes.position.array, N = geo.attributes.normal.array;
    const SI = geo.attributes.skinIndex.array, SW = geo.attributes.skinWeight.array;
    const bones = skeleton.bones, binv = skeleton.boneInverses;
    const bind = mesh0.bindMatrix, bindInv = mesh0.bindMatrixInverse;
    const boneM = new Float32Array(bones.length * 16);
    const tmp = new THREE.Matrix4();
    this.handMats = {}; // clip -> Float32Array(frames*16) hand_r transform in model space (for far umbrellas)
    const handIdx = bones.findIndex((b) => b.name === 'hand_r');
    for (const [name, cr] of Object.entries(clipRows)) {
      const clip = entry.clips[name];
      const action = mixer.clipAction(clip);
      mixer.stopAllAction();
      action.reset().play(); action.setEffectiveWeight(1);
      const hm = new Float32Array(cr.frames * 16);
      for (let f = 0; f < cr.frames; f++) {
        action.time = (f / cr.frames) * clip.duration;
        mixer.update(0);
        bakeRoot.updateMatrixWorld(true);
        for (let b = 0; b < bones.length; b++) {
          // bindMatrixInverse * boneWorld * boneInverse * bindMatrix
          tmp.multiplyMatrices(bones[b].matrixWorld, binv[b]);
          tmp.premultiply(bindInv).multiply(bind);
          tmp.toArray(boneM, b * 16);
        }
        if (handIdx >= 0) { tmp.fromArray(boneM, handIdx * 16); tmp.toArray(hm, f * 16); }
        const rowBase = (cr.start + f) * R * W;
        for (let v = 0; v < nV; v++) {
          const x = P[v * 3], y = P[v * 3 + 1], z = P[v * 3 + 2];
          const nx = N[v * 3], ny = N[v * 3 + 1], nz = N[v * 3 + 2];
          let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
          for (let k = 0; k < 4; k++) {
            const w = SW[v * 4 + k]; if (w <= 0) continue;
            const o = SI[v * 4 + k] * 16, e = boneM;
            px += w * (e[o] * x + e[o + 4] * y + e[o + 8] * z + e[o + 12]);
            py += w * (e[o + 1] * x + e[o + 5] * y + e[o + 9] * z + e[o + 13]);
            pz += w * (e[o + 2] * x + e[o + 6] * y + e[o + 10] * z + e[o + 14]);
            qx += w * (e[o] * nx + e[o + 4] * ny + e[o + 8] * nz);
            qy += w * (e[o + 1] * nx + e[o + 5] * ny + e[o + 9] * nz);
            qz += w * (e[o + 2] * nx + e[o + 6] * ny + e[o + 10] * nz);
          }
          const il = 1 / Math.max(1e-6, Math.hypot(qx, qy, qz));
          const t = (rowBase + v) * 4;
          pos[t] = toHalf(px); pos[t + 1] = toHalf(py); pos[t + 2] = toHalf(pz); pos[t + 3] = toHalf(1);
          nrm[t] = toHalf(qx * il); nrm[t + 1] = toHalf(qy * il); nrm[t + 2] = toHalf(qz * il); nrm[t + 3] = toHalf(0);
        }
      }
      this.handMats[name] = hm;
    }
    mixer.stopAllAction();
    mixer.uncacheRoot(bakeRoot);
    const mk = (arr) => {
      const t = new THREE.DataTexture(arr, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
      t.minFilter = t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; return t;
    };
    this.posTex = mk(pos); this.nrmTex = mk(nrm);
    // instanced geometry (only color + index needed; positions come from texture, keep position for bounds)
    const ig = new THREE.InstancedBufferGeometry();
    ig.index = geo.index;
    ig.setAttribute('position', geo.attributes.position);
    ig.setAttribute('normal', geo.attributes.normal);
    ig.setAttribute('color', geo.attributes.color);
    this.iA = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4); // xyz pos, yaw
    this.iB = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4); // frame, start, frames, scale
    this.iC = new THREE.InstancedBufferAttribute(new Float32Array(maxInstances * 4), 4); // tint rgb, unused
    this.iA.setUsage(THREE.DynamicDrawUsage); this.iB.setUsage(THREE.DynamicDrawUsage); this.iC.setUsage(THREE.DynamicDrawUsage);
    ig.setAttribute('iA', this.iA); ig.setAttribute('iB', this.iB); ig.setAttribute('iC', this.iC);
    ig.instanceCount = 0;
    this.geometry = ig;
    this.material = this.makeMaterial();
    this.mesh = new THREE.Mesh(ig, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false; this.mesh.receiveShadow = true;
    this.mesh.name = 'crowd_vat_' + outfit;
    this.count = 0;
  }

  makeMaterial() {
    const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.62, metalness: 0.02, side: THREE.DoubleSide });
    const posTex = this.posTex, nrmTex = this.nrmTex, W = this.W, R = this.R;
    const iA = attribute('iA', 'vec4'), iB = attribute('iB', 'vec4'), iC = attribute('iC', 'vec4');
    m.positionNode = Fn(() => {
      const vid = int(vertexIndex);
      const f = iB.x;
      const f0 = floor(f);
      const a = f.sub(f0);
      const n = iB.z;
      const r0 = int(iB.y.add(mod(f0, n))).mul(R);
      const r1 = int(iB.y.add(mod(f0.add(1), n))).mul(R);
      const x = vid.mod(W), yo = vid.div(W);
      const p = mix(textureLoad(posTex, ivec2(x, r0.add(yo))).xyz, textureLoad(posTex, ivec2(x, r1.add(yo))).xyz, a);
      const q = mix(textureLoad(nrmTex, ivec2(x, r0.add(yo))).xyz, textureLoad(nrmTex, ivec2(x, r1.add(yo))).xyz, a);
      const c = cos(iA.w), s = sin(iA.w);
      const sc = iB.w;
      const pr = vec3(p.x.mul(c).add(p.z.mul(s)), p.y, p.z.mul(c).sub(p.x.mul(s))).mul(sc).add(iA.xyz);
      normalLocal.assign(vec3(q.x.mul(c).add(q.z.mul(s)), q.y, q.z.mul(c).sub(q.x.mul(s))).normalize());
      return pr;
    })();
    const col = attribute('color', 'vec4');
    const up = clamp(normalWorld.y.mul(0.6).add(0.55), 0, 1);
    const wet = CROWD_U.wetness.mul(up);
    m.colorNode = vec4(col.rgb.mul(iC.rgb).mul(float(1).sub(wet.mul(0.18))), 1);
    m.roughnessNode = mix(float(0.62), float(0.38), wet);
    m.emissiveNode = col.rgb.mul(col.a).mul(0.45);
    return m;
  }

  begin() { this.count = 0; }

  push(x, y, z, yaw, clip, time, scale, tint) {
    if (this.count >= this.max) return false;
    const cr = this.clipRows[clip] || this.clipRows.walk;
    const i = this.count++;
    const A = this.iA.array, B = this.iB.array, Cc = this.iC.array;
    A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = z; A[i * 4 + 3] = yaw;
    B[i * 4] = time * cr.frames; B[i * 4 + 1] = cr.start; B[i * 4 + 2] = cr.frames; B[i * 4 + 3] = scale;
    Cc[i * 4] = tint[0]; Cc[i * 4 + 1] = tint[1]; Cc[i * 4 + 2] = tint[2];
    return true;
  }

  // hand_r transform (model space) for far umbrellas, interpolated to nearest frame
  handMatrix(clip, time, out) {
    const hm = this.handMats[clip]; const cr = this.clipRows[clip];
    if (!hm) return null;
    const f = Math.floor(((time % 1) + 1) % 1 * cr.frames) % cr.frames;
    return out.fromArray(hm, f * 16);
  }

  end() {
    this.geometry.instanceCount = this.count;
    this.iA.needsUpdate = true; this.iB.needsUpdate = true; this.iC.needsUpdate = true;
    this.iA.clearUpdateRanges(); this.iA.addUpdateRange(0, this.count * 4);
    this.iB.clearUpdateRanges(); this.iB.addUpdateRange(0, this.count * 4);
    this.iC.clearUpdateRanges(); this.iC.addUpdateRange(0, this.count * 4);
    this.mesh.visible = this.count > 0;
  }
}

function findRoot(o) { while (o.parent) o = o.parent; return o; }
