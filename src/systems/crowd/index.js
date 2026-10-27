// Crowd system: pedestrians on sidewalks / cross streets / promenade / alley + idlers at shopfronts.
// Near NPCs: SkeletonUtils clones (skinned, AnimationMixer at distance-based rate + lifelike head-tracking & stimulus response).
// Far NPCs: VAT instanced draws per outfit (see vat.js). Deterministic in shot mode (seeded).
import * as THREE from 'three/webgpu';
import { CharacterLibrary, CROWD_U } from './characters.js';
import { VatOutfit, VAT_MAP } from './vat.js';
import { Population } from './agents.js';

const NEAR_R = 65;        // skinned radius
const MAX_SKINNED = 64;   // simultaneous skinned NPCs
const FAR_R = 165;        // VAT radius
const VAT_MAX = 220;      // per-outfit instance cap

const _v = new THREE.Vector3(), _f = new THREE.Vector3(), _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);

export default {
  async init(ctx) {
    this.ctx = ctx;
    const lib = new CharacterLibrary(ctx);
    this.lib = lib;
    ctx.api.crowd = {
      createCharacter: (variant) => lib.createCharacter(variant),
      library: lib,
      ready: false,
    };
    const ok = await lib.load();
    if (!ok) { console.warn('[crowd] no character assets found'); return; }
    this.group = new THREE.Group(); this.group.name = 'crowd';
    ctx.scene.add(this.group);
    const qs = new URLSearchParams(location.search);

    // population
    this.pop = new Population(ctx, lib, 20771);
    this.pop.spawn();
    this.prevPlayerPos = new THREE.Vector3();
    this.hasPrevPlayer = false;

    // VAT far renderers per outfit
    this.vats = {};
    const t0 = performance.now();
    for (const { sex, outfit } of lib.outfitList) {
      try {
        const v = new VatOutfit(lib, lib.sexes[sex], outfit, VAT_MAX);
        this.vats[sex + ':' + outfit] = v;
        this.group.add(v.mesh);
      } catch (e) { console.warn('[crowd] VAT bake failed', outfit, e); }
    }
    // Far umbrellas are intentionally not instanced: the source umbrella meshes live in a different bind
    // space than the baked hand matrix, so the domes landed at the NPCs' feet as dark blobs. Near-LOD
    // characters (within NEAR_R) still carry real skinned umbrellas, which is all you can read at distance.
    this.farUmb = {};
    if (qs.has('crowdtest')) { this.initTest(ctx, qs.get('crowdtest')); return; }
    console.log(`[crowd] ${this.pop.agents.length} agents, ${Object.keys(this.vats).length} VAT outfits baked in ${(performance.now() - t0).toFixed(0)}ms`);

    // skinned pool
    this.pool = new Map(); // key -> [char]
    this.skinnedCount = 0;
    this.frame = 0;
    // pre-warm: 3 clones per outfit
    for (const { sex, outfit } of lib.outfitList) for (let i = 0; i < 3; i++) this.release(this.makeChar(sex, outfit));
    ctx.api.crowd.ready = true;
    ctx.api.crowd.agents = this.pop.agents;
    this.clipInfoFn = (ag) => lib.sexes[ag.sex].meta.clips[ag.clip] || lib.sexes[ag.sex].meta.clips.walk;
  },

  // Dev lineup (?crowdtest=clips|outfits): characters in front of the street camera for close inspection.
  initTest(ctx, mode) {
    const lib = this.lib;
    this.test = [];
    const items = [];
    if (mode === 'outfits') {
      for (const o of lib.outfitList) items.push({ ...o, clip: 'walk' });
    } else {
      const clips = [['walk', null, false], ['walk_fast', null, false], ['umbrella_walk', 'black', false], ['umbrella_walk', 'clear', false],
        ['umbrella_walk', 'led', false], ['phone_walk', null, true], ['idle', null, false], ['phone_idle', null, true], ['umbrella_idle', 'black', false]];
      clips.forEach(([clip, umbrella, phone], i) => items.push({ sex: i % 2 ? 'female' : 'male', outfit: null, clip, umbrella, phone, seed: i * 7 + 3 }));
    }
    const n = items.length;
    if (mode === 'vat') {
      for (const o of lib.outfitList) items.push({ ...o, clip: 'walk' });
      this.test = null;
      this.testVat = items.filter((it) => it.outfit).map((it, i) => ({ ...it, x: 1.5 + ((i % 6) - 2.5) * 0.95, z: 24.5 - Math.floor(i / 6) * 2.2, yaw: 0.35,
        phase: 0.3, clip: ['walk', 'umbrella_walk', 'umbrella_idle', 'idle'][i % 4], umbrella: i % 4 === 1 ? 'black' : i % 4 === 2 ? 'led' : null }));
      ctx.api.crowd.ready = true;
      return;
    }
    items.forEach((it, i) => {
      const ch = lib.createCharacter({ ...it, seed: it.seed ?? i * 5 + 1 });
      if (!ch) return;
      const row = mode === 'outfits' ? Math.floor(i / 6) : 0;
      const col = mode === 'outfits' ? i % 6 : i;
      const cols = mode === 'outfits' ? 6 : n;
      ch.object.position.set(1.5 + (col - (cols - 1) / 2) * 0.95, ctx.api.ground?.heightAt?.(0, 24) ?? 0, 24.5 - row * 2.2);
      ch.object.rotation.y = 0.35;
      ch.object.position.y += ch.sole;
      ch.play(it.clip, 0);
      ch.current.time = 0.3 * ch.current.getClip().duration;
      this.group.add(ch.object);
      this.test.push(ch);
    });
    ctx.api.crowd.ready = true;
  },

  drawFar(far) {
    for (const v of Object.values(this.vats)) v.begin();
    for (const u of Object.values(this.farUmb)) u.count = 0;
    for (const ag of far) {
      const v = this.vats[ag.sex + ':' + ag.outfit];
      if (!v) continue;
      const clip = VAT_MAP[ag.clip] || 'walk';
      const sole = this.lib.sexes[ag.sex].meta.outfits[ag.outfit].sole;
      const sc = ag.scale ?? 1;
      const tint = TINTS[(ag.tint ?? 0) % TINTS.length];
      if (!v.push(ag.x, ag.y + sole * sc, ag.z, ag.yaw, clip, ag.phase ?? 0, sc, tint)) continue;
      if (ag.umbrella && this.farUmb[ag.umbrella]) {
        const u = this.farUmb[ag.umbrella];
        if (v.handMatrix(clip, ag.phase ?? 0, _m2)) {
          _q.setFromAxisAngle(_up, ag.yaw); _s.setScalar(sc); _p.set(ag.x, ag.y + sole * sc, ag.z);
          _m.compose(_p, _q, _s).multiply(_m2);
          for (const im of u.parts) im.setMatrixAt(u.count, _m);
          u.count++;
        }
      }
    }
    for (const v of Object.values(this.vats)) v.end();
    for (const u of Object.values(this.farUmb)) for (const im of u.parts) { im.count = u.count; im.instanceMatrix.needsUpdate = true; }
  },

  makeChar(sex, outfit) {
    const ch = this.lib.createCharacter({ sex, outfit, seed: 1 });
    ch.key = sex + ':' + outfit;
    this.skinnedCount++;
    return ch;
  },

  acquire(ag) {
    const key = ag.sex + ':' + ag.outfit;
    let arr = this.pool.get(key);
    let ch = arr && arr.pop();
    if (!ch) ch = this.makeChar(ag.sex, ag.outfit);
    ch.setTint(ag.tint, ag.hairTint);
    const showPhone = Boolean(ag.phone && (ag.clip === 'phone_idle' || ag.clip === 'phone_walk'));
    ch.setAccessory(ag.umbrella, showPhone);
    ch.lastShowPhone = showPhone;
    ch.current = null;
    ch.play(ag.clip, 0);
    ch.current.time = ag.phase * ch.current.getClip().duration;
    ch.object.scale.setScalar(ag.scale);
    ch.mixer.update(0);
    this.group.add(ch.object);
    ch.acc = 0;
    return ch;
  },

  release(ch) {
    if (ch.object.parent) ch.object.parent.remove(ch.object);
    let arr = this.pool.get(ch.key); if (!arr) this.pool.set(ch.key, (arr = []));
    arr.push(ch);
  },

  update(dt, t, ctx) {
    if (this.test) { for (const ch of this.test) ch.mixer.update(dt); return; }
    if (this.testVat) {
      for (const a of this.testVat) a.y = ctx.api.ground?.heightAt?.(a.x, a.z) ?? 0;
      this.drawFar(this.testVat);
      return;
    }
    if (!this.pop) return;
    const w = ctx.weather || {};
    CROWD_U.wetness.value = w.wetness ?? 1; CROWD_U.rain.value = w.rain ?? 1;
    this.frame++;
    const cam = ctx.camera;

    // Compute player & vehicle stimulus info for lifelike NPC reactions
    const playerObj = ctx.api.player?.object;
    const playerPos = playerObj ? playerObj.position : cam.position;
    let playerSpeed = 0;
    if (this.hasPrevPlayer && dt > 1e-4) {
      playerSpeed = Math.hypot(playerPos.x - this.prevPlayerPos.x, playerPos.z - this.prevPlayerPos.z) / dt;
    }
    this.prevPlayerPos.copy(playerPos);
    this.hasPrevPlayer = true;
    const stimuli = {
      playerPos,
      playerSpeed,
      playerMode: ctx.api.player?.mode || 'foot',
      activeCar: ctx.api.vehicles?.activeCar || null,
    };

    this.pop.update(dt, this.clipInfoFn, stimuli);
    const heightAt = ctx.api.ground?.heightAt;
    cam.getWorldDirection(_f);
    const cx = cam.position.x, cz = cam.position.z;
    // classify
    const near = [];
    const far = [];
    for (const ag of this.pop.agents) {
      const dx = ag.x - cx, dz = ag.z - cz;
      const d2 = dx * dx + dz * dz;
      ag.dist = Math.sqrt(d2);
      if (ag.dist > FAR_R) { ag.vis = false; continue; }
      const fd = (dx * _f.x + dz * _f.z) / Math.max(1e-3, ag.dist * Math.hypot(_f.x, _f.z));
      if (ag.dist > 4 && fd < -0.25) { ag.vis = false; continue; }
      ag.vis = true;
      ag.y = (heightAt ? heightAt(ag.x, ag.z) : 0);
      const hyst = ag.char ? 4 : 0;
      if (ag.dist < NEAR_R + hyst) near.push(ag); else far.push(ag);
    }
    near.sort((a, b) => a.dist - b.dist);
    const chosen = new Set(near.slice(0, MAX_SKINNED));
    for (let i = MAX_SKINNED; i < near.length; i++) far.push(near[i]);
    // release skinned reps no longer chosen
    for (const ag of this.pop.agents) {
      if (ag.char && !chosen.has(ag)) { this.release(ag.char); ag.char = null; }
    }
    // update skinned
    for (const ag of chosen) {
      if (!ag.char) ag.char = this.acquire(ag);
      const ch = ag.char;
      ch.object.position.set(ag.x, ag.y + ch.sole * ag.scale, ag.z);
      ch.object.rotation.y = ag.yaw;

      // Sync phone accessory if agent dynamically pulled out or put away their phone
      const showPhone = Boolean(ag.phone && (ag.clip === 'phone_idle' || ag.clip === 'phone_walk' || ag.clip === 'photo'));
      if (ch.lastShowPhone !== showPhone) {
        ch.setAccessory(ag.umbrella, showPhone);
        ch.lastShowPhone = showPhone;
      }

      if (ch.current?.getClip().name !== ag.clip) ch.play(ag.clip, 0);
      // Lock animation phase directly to ground displacement every frame so feet never slide
      const cur = ch.current;
      if (cur) {
        cur.time = (ag.phase ?? 0) * cur.getClip().duration;
      }
      ch.mixer.timeScale = 1;
      ch.mixer.update(0);

        // Apply lifelike procedural bone animations (gait counter-sway, breathing, stall/shopfront gaze, conversational nods & startle flinch)
        if (ch.bones && ag.dist < 28) {
          const hy = ag.headYaw || 0;
          const hp = ag.headPitch || 0;
          const flinch = ag.flinch || 0;
          const isMoving = ag.kind === 'walk' && (ag.pause || 0) <= 0;
          const cyc = (ag.phase ?? 0) * Math.PI * 2;
          const breath = Math.sin(t * 2.2 + ag.id * 1.7) * 0.022;
          const gaitSway = isMoving ? Math.sin(cyc) * 0.045 : Math.sin(t * 1.1 + ag.id) * 0.015;
          const shopBrowseYaw = isMoving ? Math.sin(t * 0.75 + ag.id * 2.1) * 0.14 : 0;
          const talkNod = (!isMoving && !ag.phone) ? Math.max(0, Math.sin(t * 3.4 + ag.id * 1.3)) * 0.055 : 0;

          if (ch.bones.spine1) {
            ch.bones.spine1.rotation.x += breath + (isMoving ? 0.035 : 0);
            ch.bones.spine1.rotation.z += gaitSway * 0.6;
          }
          if (ch.bones.spine2) {
            ch.bones.spine2.rotation.y += (isMoving ? Math.cos(cyc) * 0.038 : Math.sin(t * 0.9 + ag.id) * 0.025);
            ch.bones.spine2.rotation.z += -gaitSway * 0.45 + ((ag.id % 2 ? 1 : -1) * flinch * 0.10);
          }
          if (ch.bones.neck) {
            ch.bones.neck.rotation.y += (hy + shopBrowseYaw) * 0.42;
            ch.bones.neck.rotation.x += hp * 0.35 + talkNod * 0.4 - flinch * 0.08;
          }
          if (ch.bones.head) {
            ch.bones.head.rotation.y += (hy + shopBrowseYaw) * 0.65 + Math.sin(t * 1.4 + ag.id) * 0.04;
            ch.bones.head.rotation.x += hp * 0.65 + talkNod * 0.6;
            ch.bones.head.rotation.z += gaitSway * 0.25;
          }
        }
    }
    this.drawFar(far);
    this.stats = { skinned: chosen.size, far: far.length };
    if (ctx.isShot && this.frame === 60) console.log(`[crowd] skinned ${chosen.size}, far ${far.length}, total ${this.pop.agents.length}`);
  },
};

// Mild per-instance albedo variation for far NPCs
const TINTS = [[1, 1, 1], [0.92, 0.94, 0.98], [0.88, 0.87, 0.85], [0.96, 0.93, 0.90], [0.85, 0.88, 0.92], [1, 0.97, 0.96]];
