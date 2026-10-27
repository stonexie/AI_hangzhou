// Pedestrian population: lanes from LAYOUT, reduced comfortable crowd density, modern Chinese casual outfits,
// "抱头小跑" (cover_run) rain-jogging behavior, spontaneous everyday life actions,
// and stimulus reactions without any ground-sliding or road-blocking idlers.
import { ACTION_CLIPS } from './actions.js';

const ACTION_DUR = Object.fromEntries(ACTION_CLIPS.map((c) => [c.name, c.duration]));
// everyday actions that read well on a standing NPC (skips the ones needing props/interaction)
const IDLE_ACTION_POOL = ['yawn', 'stretch', 'look_around', 'chat', 'drink', 'photo', 'check_watch', 'adjust_collar', 'wave_hello'];
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function buildLanes(L) {
  const lanes = [];
  const A = L.avenue, C = L.crossStreets, P = L.promenade, AL = L.alley;
  const add = (ax, az, bx, bz, hw, density, district) => {
    const len = Math.hypot(bx - ax, bz - az);
    lanes.push({ ax, az, bx, bz, len, hw, density, district, dx: (bx - ax) / len, dz: (bz - az) / len });
  };
  const sx = A.roadHalfWidth + A.sidewalkWidth / 2; // 8
  // Avenue sidewalks: comfortable density
  add(sx + 0.15, A.zStart, sx + 0.15, A.zEnd, A.sidewalkWidth / 2 - 0.55, 1 / 5.4, 'avenue');
  add(-sx - 0.15, A.zStart, -sx - 0.15, A.zEnd, A.sidewalkWidth / 2 - 0.55, 1 / 5.4, 'avenue');
  // Cross streets
  const cz = C.roadHalfWidth + C.sidewalkWidth / 2;
  const xIn = A.roadHalfWidth + A.sidewalkWidth + 0.5;
  for (const z of C.zs) {
    for (const s of [1, -1]) {
      add(-xIn, z + s * cz, C.xStart, z + s * cz, C.sidewalkWidth / 2 - 0.45, 1 / 16, 'cross');
      add(xIn, z + s * cz, P.xMin - 1, z + s * cz, C.sidewalkWidth / 2 - 0.45, 1 / 16, 'cross');
    }
  }
  // Riverside promenade
  const pc = (P.xMin + P.xMax) / 2;
  add(pc - 1.2, P.zStart, pc - 1.2, P.zEnd, (P.xMax - P.xMin) / 2 - 2.2, 1 / 8.5, 'river');
  // Alley
  add(AL.xStart - 1.5, AL.z, AL.xEnd + 4, AL.z, AL.width / 2 - 0.7, 1 / 9, 'alley');
  return lanes;
}

// Includes 'cover_run' (双手抱头遮雨小跑) alongside normal walking clips
const WALK_CLIPS = ['walk_slow', 'walk', 'walk', 'walk_fast', 'cover_run'];

export class Population {
  constructor(ctx, lib, seed = 1337) {
    this.ctx = ctx; this.lib = lib;
    this.rnd = mulberry32(seed);
    this.agents = [];
    this.lanes = buildLanes(ctx.layout);
    this.grid = new Map();
  }

  pickLook(r) {
    const preferred = [
      { sex: 'female', outfit: 'f_casual' },   // 白T恤配复古牛仔裤
      { sex: 'female', outfit: 'f_casual' },
      { sex: 'female', outfit: 'f_hoodie' },   // 燕麦色/雾霾蓝连帽卫衣配休闲裤
      { sex: 'female', outfit: 'f_hoodie' },
      { sex: 'female', outfit: 'f_techwear' }, // 冰川白/浅粉城市防晒冲锋衣
      { sex: 'female', outfit: 'f_trench' },   // 奶茶色/卡其色休闲风衣
      { sex: 'female', outfit: 'f_raincoat' }, // 休闲短款外套配半身裙
      { sex: 'male', outfit: 'm_hoodie' },     // 高级灰/米白连帽卫衣配运动裤
      { sex: 'male', outfit: 'm_hoodie' },
      { sex: 'male', outfit: 'm_jacket' },     // 丹宁/工装休闲夹克配牛仔裤
      { sex: 'male', outfit: 'm_jacket' },
      { sex: 'male', outfit: 'm_techwear' },   // 山系户外拼色冲锋衣
      { sex: 'male', outfit: 'm_trench' },     // 卡其/驼色中长款休闲外套
      { sex: 'male', outfit: 'm_raincoat' },   // 城市防风连帽夹克
    ];
    const list = this.lib.outfitList;
    let pick = preferred[Math.floor(r() * preferred.length)];
    if (!list.some((x) => x.sex === pick.sex && x.outfit === pick.outfit)) {
      pick = list[Math.floor(r() * list.length)];
    }
    return {
      sex: pick.sex,
      outfit: pick.outfit,
      tint: Math.floor(r() * 997),
      hairTint: Math.floor(r() * 991),
      scale: 0.95 + r() * 0.09,
    };
  }

  rainGear(r, ag) {
    const u = r();
    if (u < 0.18) ag.umbrella = 'led';
    else if (u < 0.32) ag.umbrella = 'clear';
    else if (u < 0.42) ag.umbrella = 'black';
    else ag.umbrella = null;
    ag.phone = !ag.umbrella && r() < 0.30;
  }

  isInRoadOrIntersection(x, z) {
    const L = this.ctx.layout;
    const A = L.avenue, C = L.crossStreets;
    if (Math.abs(x) < A.roadHalfWidth + 0.8) return true;
    for (const cz of C.zs) {
      if (Math.abs(z - cz) < C.roadHalfWidth + 1.2) return true;
    }
    return false;
  }

  spawn() {
    const r = this.rnd;
    for (let li = 0; li < this.lanes.length; li++) {
      const ln = this.lanes[li];
      const n = Math.floor(ln.len * ln.density);
      for (let i = 0; i < n; i++) {
        const s = r() * ln.len;
        const dir = r() < 0.5 ? 1 : -1;
        const ag = {
          id: this.agents.length, kind: 'walk', lane: li, s, dir,
          lat: (dir > 0 ? -0.35 : 0.35) * ln.hw + (r() - 0.5) * ln.hw * 1.1,
          ...this.pickLook(r),
          x: 0, y: 0, z: 0, yaw: 0, vx: 0, vz: 0, phase: r(),
          pause: 0,
          moodTimer: 4 + r() * 14,
          reactType: null,
          reactTimer: 0,
          evadeLatTarget: null,
          lookTargetYaw: null,
          headYaw: 0,
          headPitch: 0,
          flinch: 0,
        };
        ag.lat = Math.max(-ln.hw, Math.min(ln.hw, ag.lat));
        this.rainGear(r, ag);
        // About 24% of non-umbrella, non-phone pedestrians jog with hands covering their head from the rain ('cover_run')
        if (!ag.umbrella && !ag.phone && r() < 0.24) {
          ag.baseWalkClip = 'cover_run';
        } else {
          ag.baseWalkClip = WALK_CLIPS[Math.floor(r() * WALK_CLIPS.length)];
        }
        ag.clip = ag.umbrella ? 'umbrella_walk' : ag.phone ? 'phone_walk' : ag.baseWalkClip;
        ag.baseSpeedK = ag.clip === 'cover_run' ? (1.10 + r() * 0.16) : (0.92 + r() * 0.20);
        ag.speedK = ag.baseSpeedK;
        this.placeOnLane(ag);
        ag.yaw = Math.atan2(ln.dx * dir, ln.dz * dir);
        this.agents.push(ag);
      }
    }
    this.spawnIdlers();
  }

  spawnIdlers() {
    const r = this.rnd;
    const ctx = this.ctx;
    const facades = ctx.api.buildings?.facades || [];
    const spots = [];
    for (const f of facades) {
      if (!f.shopfront) continue;
      if (f.district === 'river') continue;
      spots.push(f);
    }
    const idleClip = (ag) => (ag.umbrella ? 'umbrella_idle' : ag.phone ? 'phone_idle' : (r() < 0.5 ? 'idle' : 'idle_b'));
    const addIdler = (x, z, yaw, look) => {
      // Never spawn any standing idler inside a road or intersection
      if (this.isInRoadOrIntersection(x, z)) return null;
      const ag = {
        id: this.agents.length, kind: 'idle', x, z, y: 0, yaw, baseYaw: yaw, phase: r(), ...look, vx: 0, vz: 0,
        moodTimer: 3 + r() * 10,
        reactType: null,
        reactTimer: 0,
        headYaw: 0,
        headPitch: 0,
        flinch: 0,
      };
      this.rainGear(r, ag);
      if (r() < 0.35) ag.phone = !ag.umbrella;
      ag.clip = idleClip(ag);
      this.agents.push(ag);
      return ag;
    };
    if (spots.length) {
      for (const f of spots) {
        if (r() > 0.32) continue;
        const n = r() < 0.26 ? 2 : 1;
        const nx = f.normal.x, nz = f.normal.z, rx = f.right.x, rz = f.right.z;
        const off = (r() - 0.5) * Math.min(f.width, 10) * 0.7;
        const d = 0.55 + r() * 0.5;
        const x = f.center.x + nx * d + rx * off, z = f.center.z + nz * d + rz * off;
        const outYaw = Math.atan2(nx, nz);
        if (n === 2) {
          const yaw = outYaw + Math.PI / 2 + (r() - 0.5) * 0.4;
          const fx = Math.sin(yaw), fz = Math.cos(yaw);
          const a1 = addIdler(x - fx * 0.5, z - fz * 0.5, yaw, this.pickLook(r));
          const a2 = addIdler(x + fx * 0.5, z + fz * 0.5, yaw + Math.PI, this.pickLook(r));
          if (a1 && a2) {
            a1.partner = a2;
            a2.partner = a1;
          }
        } else {
          const lookIn = r() < 0.42;
          addIdler(x, z, (lookIn ? outYaw + Math.PI : outYaw) + (r() - 0.5) * 0.7, this.pickLook(r));
        }
      }
    } else {
      const A = ctx.layout.avenue;
      for (let z = A.zStart; z > A.zEnd; z -= 12 + r() * 14) {
        for (const s of [1, -1]) {
          if (r() < 0.65) continue;
          const x = s * (A.roadHalfWidth + A.sidewalkWidth - 0.45);
          addIdler(x, z + r() * 3, s > 0 ? -Math.PI / 2 + (r() - 0.5) : Math.PI / 2 + (r() - 0.5), this.pickLook(r));
        }
      }
    }

    // Spawn dedicated night-market stall visitors & spawn-front showcase NPCs (all 4 AI 3D PBR archetypes)
    const stallVisitors = [
      { x: -6.7, z: 21.8, yaw:  Math.PI * 0.22, action: 'photo', outfit: { sex: 'female', outfit: 'f_trench', tint: 0, hairTint: 0 } },   // 宋制汉服少女（出生点左前方）
      { x: -6.9, z: 19.6, yaw:  Math.PI * 0.12, action: 'chat', outfit: { sex: 'male',   outfit: 'm_jacket', tint: 0, hairTint: 0 } },   // 新中式立领盘扣男（出生点左前方）
      { x:  6.7, z: 21.2, yaw: -Math.PI * 0.25, action: 'drink', outfit: { sex: 'female', outfit: 'f_casual', tint: 1, hairTint: 1 } },   // 现代燕麦风衣女（出生点右前方）
      { x:  6.9, z: 19.0, yaw: -Math.PI * 0.15, action: 'look_around', outfit: { sex: 'male',   outfit: 'm_techwear', tint: 1, hairTint: 0 } }, // 都市山系冲锋衣男（出生点右前方）
      { x: -7.1, z: 12.2, yaw: -Math.PI * 0.55, action: 'eat', outfit: { sex: 'female', outfit: 'f_trench', tint: 2, hairTint: 1 } },   // 面摊前吃面的汉服顾客
      { x: -7.3, z: 10.6, yaw: -Math.PI * 0.35, action: 'eat', outfit: { sex: 'male',   outfit: 'm_jacket', tint: 1, hairTint: 0 } },   // 面摊前吃面的国潮顾客
      { x:  7.1, z: -5.5, yaw:  Math.PI * 0.52, action: 'check_watch', outfit: { sex: 'female', outfit: 'f_casual', tint: 3, hairTint: 2 } }, // 看表的通勤女
      { x: -7.1, z: -37.5, yaw: -Math.PI * 0.48, action: 'adjust_collar', outfit: { sex: 'female', outfit: 'f_hoodie', tint: 4, hairTint: 0 } }, // 整理衣领的路人
    ];
    for (const sv of stallVisitors) {
      const ag = addIdler(sv.x, sv.z, sv.yaw, { ...sv.outfit, scale: 1.0 });
      if (ag) {
        ag.umbrella = null;
        ag.phone = sv.action === 'photo';
        ag.clip = sv.action;
        ag.actionTimer = (ACTION_DUR[sv.action] || 3) + 0.3;
        ag.phase = 0;
      }
    }
  }

  placeOnLane(ag) {
    const ln = this.lanes[ag.lane];
    ag.x = ln.ax + ln.dx * ag.s + ln.dz * ag.lat;
    ag.z = ln.az + ln.dz * ag.s - ln.dx * ag.lat;
  }

  // Ensure a walking agent never has an idle clip when pause <= 0
  ensureWalkClip(ag) {
    if (!ag.clip || ag.clip.includes('idle')) {
      ag.clip = ag.umbrella ? 'umbrella_walk' : ag.phone ? 'phone_walk' : (ag.baseWalkClip || 'walk');
    }
  }

  // -------------------------------------------------------------------------------- simulation & stimulus response
  update(dt, clipInfo, stimuli = null) {
    const grid = this.grid; grid.clear();
    const cell = 2.0;
    const key = (x, z) => ((Math.floor(x / cell) + 4096) * 8192 + (Math.floor(z / cell) + 4096));
    for (const ag of this.agents) {
      const k = key(ag.x, ag.z);
      let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(ag);
    }

    const pPos = stimuli?.playerPos;
    const pSpeed = stimuli?.playerSpeed ?? 0;
    const pMode = stimuli?.playerMode ?? 'foot';
    const activeCar = stimuli?.activeCar;

    for (const ag of this.agents) {
      ag.moodTimer -= dt;
      if (ag.reactTimer > 0) {
        ag.reactTimer = Math.max(0, ag.reactTimer - dt);
        if (ag.reactTimer === 0) {
          ag.reactType = null;
          ag.evadeLatTarget = null;
          ag.speedK = ag.baseSpeedK || 1.0;
          if (ag.kind === 'walk' && !(ag.pause > 0)) {
            ag.clip = ag.umbrella ? 'umbrella_walk' : ag.phone ? 'phone_walk' : (ag.baseWalkClip || 'walk');
          }
        }
      }
      ag.flinch = Math.max(0, (ag.flinch || 0) - dt * 2.8);

      // --- 1. Check Player & Vehicle Stimulus (刺激反应: 靠近注视、抱头小跑闪避) ---
      let targetHeadYaw = 0;
      let targetHeadPitch = 0;

      if (pPos) {
        const dxP = pPos.x - ag.x;
        const dzP = pPos.z - ag.z;
        const dP2 = dxP * dxP + dzP * dzP;

        if (dP2 < 36.0) { // within 6m of player
          const dP = Math.sqrt(dP2);
          const angleToPlayer = Math.atan2(dxP, dzP);
          let relYaw = angleToPlayer - ag.yaw;
          relYaw = Math.atan2(Math.sin(relYaw), Math.cos(relYaw));

          if (dP < 4.5 && Math.abs(relYaw) < 1.35) {
            targetHeadYaw = Math.max(-0.62, Math.min(0.62, relYaw * 0.72));
            targetHeadPitch = dP < 2.4 ? 0.08 : 0.03;
          }

          const isVehicleThreat = (pMode === 'car' || activeCar) && dP < 5.8 && pSpeed > 2.2;
          const isSprintThreat = pMode === 'foot' && dP < 3.2 && pSpeed > 4.0;
          const isCloseBump = pMode === 'foot' && dP < 1.55;

          if ((isVehicleThreat || isSprintThreat || isCloseBump) && ag.reactTimer <= 0.2) {
            if (isVehicleThreat || isSprintThreat) {
              // Startled evasion: hands-over-head rain jog ('cover_run') & smooth lateral sidestep
              ag.reactType = 'evade';
              ag.reactTimer = 2.6 + ((ag.id % 5) * 0.25);
              ag.pause = 0;
              ag.flinch = 1.0;
              if (ag.kind === 'walk') {
                ag.phone = false;
                ag.clip = ag.umbrella ? 'umbrella_walk' : 'cover_run';
                ag.speedK = 1.32;
                const ln = this.lanes[ag.lane];
                if (ln) {
                  const latSign = (dxP * ln.dz - dzP * ln.dx) >= 0 ? -1 : 1;
                  ag.evadeLatTarget = Math.max(-ln.hw, Math.min(ln.hw, ag.lat + latSign * 0.75));
                }
              } else {
                ag.lookTargetYaw = angleToPlayer;
                ag.clip = ag.umbrella ? 'umbrella_idle' : 'idle_b';
              }
            } else if (isCloseBump) {
              ag.reactType = 'look_player';
              ag.reactTimer = 2.4 + ((ag.id % 4) * 0.35);
              ag.flinch = 0.55;
              ag.lookTargetYaw = angleToPlayer;
              if (ag.kind === 'walk' && !this.isInRoadOrIntersection(ag.x, ag.z)) {
                ag.pause = ag.reactTimer;
                ag.clip = ag.umbrella ? 'umbrella_idle' : ag.phone ? 'phone_idle' : 'idle_b';
              }
            }
          }

          if (ag.reactType === 'look_player') {
            ag.lookTargetYaw = angleToPlayer;
            targetHeadYaw = Math.max(-0.65, Math.min(0.65, relYaw * 0.85));
            targetHeadPitch = 0.09;
          }
        }
      }

      ag.headYaw += (targetHeadYaw - (ag.headYaw || 0)) * Math.min(1, dt * 6.5);
      ag.headPitch += (targetHeadPitch - (ag.headPitch || 0)) * Math.min(1, dt * 6.5);

      // --- 2. Idler Lifelike Behavior ---
      if (ag.kind === 'idle') {
        const info = clipInfo(ag);
        // one-shot everyday action (打哈欠/伸懒腰/东张西望/聊天/喝水/拍照/看表/整理衣领)
        if (ag.actionTimer > 0) {
          ag.actionTimer -= dt;
          if (ag.actionTimer <= 0) {
            ag.actionTimer = 0;
            ag.clip = ag.phone ? 'phone_idle' : 'idle';
            ag.phase = 0;
          }
        }
        if (ag.moodTimer <= 0 && !ag.reactType && !(ag.actionTimer > 0)) {
          ag.moodTimer = 4 + ((ag.id * 17) % 8);
          ag.actionSeq = (ag.actionSeq | 0) + 1;
          const pick = ((ag.id * 7 + ag.actionSeq * 13) % 100) / 100;
          if (!ag.umbrella && pick < 0.62) {
            const a = IDLE_ACTION_POOL[(ag.id + ag.actionSeq * 3) % IDLE_ACTION_POOL.length];
            ag.phone = a === 'photo';
            ag.clip = a;
            ag.phase = 0;
            ag.actionTimer = (ACTION_DUR[a] || 3) + 0.4;
          } else if (!ag.umbrella) {
            const roll = ((ag.id + Math.floor(ag.phase * 100)) % 10) / 10;
            if (roll < 0.35) {
              ag.phone = true;
              ag.clip = 'phone_idle';
            } else if (roll < 0.68) {
              ag.phone = false;
              ag.clip = 'idle_b';
            } else {
              ag.phone = false;
              ag.clip = 'idle';
            }
          }
          if (ag.partner) {
            const pdx = ag.partner.x - ag.x, pdz = ag.partner.z - ag.z;
            ag.lookTargetYaw = Math.atan2(pdx, pdz) + (((ag.id % 3) - 1) * 0.14);
          } else if (ag.baseYaw !== undefined) {
            ag.lookTargetYaw = ag.baseYaw + (Math.sin(ag.phase * 6.28) * 0.28);
          }
        }
        if (ag.lookTargetYaw != null) {
          let dy = ag.lookTargetYaw - ag.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          ag.yaw += dy * Math.min(1, dt * 4.5);
        }
        ag.phase = (ag.phase + dt / Math.max(0.5, info.period)) % 1;
        continue;
      }

      // --- 3. Walking Pedestrian Lifelike Pauses & Micro-Transitions ---
      const ln = this.lanes[ag.lane];
      const fx = ln.dx * ag.dir, fz = ln.dz * ag.dir;

      if (ag.pause > 0) {
        ag.pause -= dt;
        const pauseInfo = clipInfo(ag);
        if (ag.lookTargetYaw != null) {
          let dy = ag.lookTargetYaw - ag.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          ag.yaw += dy * Math.min(1, dt * 5.0);
        }
        ag.phase = (ag.phase + dt / Math.max(0.5, pauseInfo.period)) % 1;
        if (ag.pause <= 0) {
          ag.pause = 0;
          ag.lookTargetYaw = null;
          ag.clip = ag.umbrella ? 'umbrella_walk' : ag.phone ? 'phone_walk' : (ag.baseWalkClip || 'walk');
        }
        continue;
      }

      // Spontaneous mood transition while strolling along the night market
      if (ag.moodTimer <= 0 && !ag.reactType) {
        ag.moodTimer = 7 + ((ag.id * 13) % 12);
        const h = (ag.id * 31 + Math.floor(ag.s * 10)) % 20;
        if (!ag.umbrella && h < 2 && ln.district === 'avenue' && !this.isInRoadOrIntersection(ag.x, ag.z)) {
          // Stop on sidewalk (never in road/intersection) to look at a night market stall
          ag.pause = 2.5 + (h * 0.8);
          ag.phone = (h % 2) === 0;
          ag.clip = ag.phone ? 'phone_idle' : 'idle_b';
          const outSign = ag.x >= 0 ? 1 : -1;
          ag.lookTargetYaw = Math.atan2(outSign, 0) + ((h - 1) * 0.25);
          continue;
        } else if (!ag.umbrella) {
          // Switch between cover_run (抱头小跑), phone_walk, walk_fast, or casual walk
          ag.phone = h >= 2 && h <= 6;
          if (!ag.phone && h >= 14 && h <= 17) {
            ag.baseWalkClip = 'cover_run';
          } else {
            ag.baseWalkClip = h >= 18 ? 'walk_fast' : h <= 4 ? 'walk_slow' : 'walk';
          }
          ag.clip = ag.phone ? 'phone_walk' : ag.baseWalkClip;
          ag.speedK = ag.baseSpeedK * (ag.clip === 'cover_run' ? 1.18 : ag.baseWalkClip === 'walk_fast' ? 1.12 : 1.0);
        }
      }

      // Guarantee walking clip is active before computing speed & stride
      this.ensureWalkClip(ag);
      const info = clipInfo(ag);
      const baseSpeed = Math.max(0.85, info.speed || 1.28);
      let v = baseSpeed * ag.speedK;

      // Avoidance: look at neighbours ahead
      let steer = 0;
      const cx = Math.floor(ag.x / cell), cz = Math.floor(ag.z / cell);
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        const a = grid.get((cx + i + 4096) * 8192 + (cz + j + 4096));
        if (!a) continue;
        for (const o of a) {
          if (o === ag) continue;
          const dx = o.x - ag.x, dz = o.z - ag.z;
          const ahead = dx * fx + dz * fz;
          if (ahead < -0.2 || ahead > 2.6) continue;
          const side = dx * fz - dz * fx; // + = to our right
          const rad = (ag.umbrella && o.umbrella) ? 1.05 : 0.62;
          if (Math.abs(side) > rad) continue;
          const urgency = 1 - Math.max(0, ahead) / 2.6;
          steer += (side >= 0 ? -1 : 1) * urgency * 1.15;
          if (ahead < 1.0) {
            v *= 0.90;
          }
        }
      }

      // Steer around the player smoothly if standing in the lane ahead
      if (pPos) {
        const dx = pPos.x - ag.x, dz = pPos.z - ag.z;
        const ahead = dx * fx + dz * fz;
        const side = dx * fz - dz * fx;
        if (ahead > -0.4 && ahead < 3.2 && Math.abs(side) < 1.15) {
          const urgency = 1 - Math.max(0, ahead) / 3.2;
          steer += (side >= 0 ? -1 : 1) * urgency * 1.85;
        }
      }

      // Never allow v to decay below 65% of natural walk speed (prevents frozen-leg lateral sliding!)
      v = Math.max(baseSpeed * 0.65, v);

      // Drift toward evade target or preferred lateral lane position
      const pref = ag.evadeLatTarget != null ? ag.evadeLatTarget : (ag.dir > 0 ? -0.35 : 0.35) * ln.hw;
      const latPull = ag.evadeLatTarget != null ? 0.85 : 0.12;
      steer += (pref - ag.lat) * latPull;
      const latVel = Math.max(-0.75, Math.min(0.75, steer)) * ag.dir * -1;
      ag.lat = Math.max(-ln.hw, Math.min(ln.hw, ag.lat + latVel * dt * 0.85));
      ag.v = v;
      ag.s += ag.dir * v * dt;
      if (ag.s < 0 || ag.s > ln.len) {
        ag.dir *= -1; ag.s = Math.max(0, Math.min(ln.len, ag.s));
      }
      const ox = ag.x, oz = ag.z;
      this.placeOnLane(ag);
      const mvx = (ag.x - ox) / Math.max(dt, 1e-4), mvz = (ag.z - oz) / Math.max(dt, 1e-4);
      const actualMoveSpeed = Math.max(v, Math.hypot(mvx, mvz));
      const targetYaw = Math.atan2(mvx * 0.5 + fx * v, mvz * 0.5 + fz * v);
      let dy = targetYaw - ag.yaw;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      ag.yaw += dy * Math.min(1, dt * 6);
      const stride = Math.max(0.25, baseSpeed * (info.period || 1.0));
      ag.phase = (ag.phase + (actualMoveSpeed * dt) / stride) % 1;
      ag.timeScale = actualMoveSpeed / baseSpeed;
    }
  }
}
