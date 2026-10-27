// Motion-capture-layered everyday action clips on the shared 53-bone crowd rig.
//
// Instead of authoring rotations on top of the static A-pose bind (which froze the lower body and
// twisted shoulders when large Euler angles were combined), every clip here samples the shipped
// 54-channel motion-captured `idle` animation as its living foundation (pelvis weight shift, breathing,
// knee micro-bends, and finger curl), and slerps the arms/head/spine toward animator-verified key poses
// extracted from `phone_idle`, `umbrella_idle`, and `cover_run`.
//
// At u = 0 and u = 1 the envelope is 0, so every action starts and ends in the exact motion-captured
// `idle` pose—eliminating transition snaps.
import * as THREE from 'three/webgpu';

const DEG = Math.PI / 180;

const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
const env = (u, a, b, c, d) => smooth((u - a) / Math.max(1e-5, b - a)) * (1 - smooth((u - c) / Math.max(1e-5, d - c)));
const wave = (u, cycles, phase = 0) => Math.sin((u * cycles + phase) * Math.PI * 2);

// Animator-verified reference arm quaternions from the shipped rig (female.glb / male.glb):
// - idle: natural hanging arms at sides
// - chest: motion-captured `phone_idle` arm posture (hand held naturally in front of chest)
// - raised: raised hand posture (derived from `cover_run` / `umbrella_idle` without shoulder twist)
const POSES = {
  idle: {
    clavicle_l: [-0.0225, -0.0302, -0.7490, 0.6615],
    upperarm_l: [ 0.1020,  0.1071, -0.5993, 0.7868],
    lowerarm_l: [ 0.1116,  0.0668,  0.0459, 0.9904],
    hand_l:     [ 0.1805,  0.4216,  0.0140, 0.8885],
    clavicle_r: [-0.0225,  0.0302,  0.7490, 0.6615],
    upperarm_r: [ 0.1107, -0.0982,  0.5977, 0.7879],
    lowerarm_r: [ 0.1116, -0.0668, -0.0459, 0.9904],
    hand_r:     [ 0.1805, -0.4216, -0.0140, 0.8885],
  },
  chest: {
    clavicle_l: [-0.0225, -0.0302, -0.7490, 0.6615],
    upperarm_l: [ 0.2525,  0.1557, -0.5538, 0.7780],
    lowerarm_l: [ 0.4677,  0.0546,  0.4872, 0.7355],
    hand_l:     [ 0.0356,  0.4404, -0.0427, 0.8961],
    clavicle_r: [-0.0225,  0.0302,  0.7490, 0.6615],
    upperarm_r: [ 0.2525, -0.1557,  0.5538, 0.7780],
    lowerarm_r: [ 0.4677, -0.0546, -0.4872, 0.7355],
    hand_r:     [ 0.0356, -0.4404,  0.0427, 0.8961],
  },
  mouth: {
    clavicle_l: [-0.0150,  0.0100, -0.7520, 0.6590],
    upperarm_l: [ 0.3650,  0.1100, -0.4650, 0.8000],
    lowerarm_l: [ 0.5200,  0.0800,  0.5850, 0.6170],
    hand_l:     [ 0.1200,  0.3800, -0.1100, 0.9105],
    clavicle_r: [-0.0150, -0.0100,  0.7520, 0.6590],
    upperarm_r: [ 0.3650, -0.1100,  0.4650, 0.8000],
    lowerarm_r: [ 0.5200, -0.0800, -0.5850, 0.6170],
    hand_r:     [ 0.1200, -0.3800,  0.1100, 0.9105],
  },
  raised: {
    clavicle_l: [ 0.0110,  0.0470, -0.7580, 0.6510],
    upperarm_l: [ 0.4850, -0.1100, -0.1200, 0.8590],
    lowerarm_l: [ 0.3611,  0.0939,  0.6887, 0.6216],
    hand_l:     [ 0.2200,  0.2100, -0.2400, 0.9195],
    clavicle_r: [ 0.0110, -0.0470,  0.7580, 0.6510],
    upperarm_r: [ 0.4850,  0.1100,  0.1200, 0.8590],
    lowerarm_r: [ 0.3611, -0.0939, -0.6887, 0.6216],
    hand_r:     [ 0.2200, -0.2100,  0.2400, 0.9195],
  },
};

const ANIM_BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
];

const _e = new THREE.Euler(), _dq = new THREE.Quaternion(), _q = new THREE.Quaternion(), _q1 = new THREE.Quaternion(), _qPose = new THREE.Quaternion();

// Correctly sample both CUBICSPLINE (stride = 3 * itemSize: [inTangent, value, outTangent]) and LINEAR tracks
function findFrame(times, t) {
  const n = times.length;
  if (n <= 1 || t <= times[0]) return { k0: 0, k1: 0, alpha: 0 };
  if (t >= times[n - 1]) return { k0: n - 1, k1: n - 1, alpha: 0 };
  let lo = 0, hi = n - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (times[mid] <= t) lo = mid; else hi = mid;
  }
  const dt = times[hi] - times[lo];
  return { k0: lo, k1: hi, alpha: dt > 1e-6 ? (t - times[lo]) / dt : 0 };
}

function sampleTrackQuat(tr, t, fallbackQ, outQ) {
  if (tr && tr.times?.length) {
    const { k0, k1, alpha } = findFrame(tr.times, t);
    const v = tr.values;
    const isCubic = v.length === tr.times.length * 12;
    const o0 = (isCubic ? (k0 * 3 + 1) : k0) * 4;
    const o1 = (isCubic ? (k1 * 3 + 1) : k1) * 4;
    outQ.set(v[o0], v[o0 + 1], v[o0 + 2], v[o0 + 3]).normalize();
    if (alpha > 1e-4 && k1 !== k0) {
      _q1.set(v[o1], v[o1 + 1], v[o1 + 2], v[o1 + 3]).normalize();
      outQ.slerp(_q1, alpha);
    }
  } else if (fallbackQ) {
    outQ.copy(fallbackQ);
  } else {
    outQ.identity();
  }
  return outQ;
}

function sampleTrackVec(tr, t, fallbackP, outArr) {
  if (tr && tr.times?.length) {
    const { k0, k1, alpha } = findFrame(tr.times, t);
    const v = tr.values;
    const isCubic = v.length === tr.times.length * 9;
    const o0 = (isCubic ? (k0 * 3 + 1) : k0) * 3;
    const o1 = (isCubic ? (k1 * 3 + 1) : k1) * 3;
    outArr[0] = v[o0] + (v[o1] - v[o0]) * alpha;
    outArr[1] = v[o0 + 1] + (v[o1 + 1] - v[o0 + 1]) * alpha;
    outArr[2] = v[o0 + 2] + (v[o1 + 2] - v[o0 + 2]) * alpha;
  } else if (fallbackP) {
    outArr[0] = fallbackP.x; outArr[1] = fallbackP.y; outArr[2] = fallbackP.z;
  } else {
    outArr[0] = 0; outArr[1] = 0; outArr[2] = 0;
  }
}

function makeClip(name, duration, poseFn, bind, baseClip, fps = 20) {
  const n = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(n);
  for (let i = 0; i < n; i++) times[i] = (i / (n - 1)) * duration;

  // Map existing mocap tracks from `idle` so fingers, pelvis, legs, and breathing stay naturally animated
  const baseQuatInterp = {};
  let basePelvisPosInterp = null;
  const baseDur = baseClip ? baseClip.duration : duration;
  const passthroughTracks = [];
  const overriddenSet = new Set(ANIM_BONES.map((b) => b + '.quaternion'));
  overriddenSet.add('pelvis.position');

  if (baseClip) {
    for (const tr of baseClip.tracks) {
      if (tr.name === 'pelvis.position') {
        basePelvisPosInterp = tr;
      } else if (overriddenSet.has(tr.name)) {
        const boneName = tr.name.slice(0, tr.name.indexOf('.'));
        baseQuatInterp[boneName] = tr;
      } else if (tr.name.endsWith('.quaternion')) {
        // Resample CUBICSPLINE passthrough tracks (Root + 30 finger joints) into standard 4-float QuaternionKeyframeTracks
        // because KeyframeTrack.prototype.clone() drops GLTFLoader's instance-level createInterpolant!
        const vals = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) {
          const u = i / (n - 1);
          const tBase = (u * baseDur) % Math.max(1e-4, baseDur);
          sampleTrackQuat(tr, tBase, null, _q);
          vals[i * 4] = _q.x; vals[i * 4 + 1] = _q.y; vals[i * 4 + 2] = _q.z; vals[i * 4 + 3] = _q.w;
        }
        passthroughTracks.push(new THREE.QuaternionKeyframeTrack(tr.name, times, vals));
      }
    }
  }

  const tracks = [...passthroughTracks];

  for (const bone of ANIM_BONES) {
    const b = bind[bone];
    if (!b && !baseQuatInterp[bone]) continue;
    const vals = new Float32Array(n * 4);
    const idleFallback = POSES.idle[bone]
      ? new THREE.Quaternion().fromArray(POSES.idle[bone])
      : (b ? b.q : new THREE.Quaternion());

    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const tBase = (u * baseDur) % Math.max(1e-4, baseDur);
      sampleTrackQuat(baseQuatInterp[bone], tBase, idleFallback, _q);

      const p = poseFn(u);
      // Optional target arm pose blend: p._armL = { target: 'chest'|'mouth'|'raised', w: 0..1 }
      const armSpec = bone.endsWith('_l') ? p._armL : bone.endsWith('_r') ? p._armR : null;
      if (armSpec && armSpec.w > 1e-4 && POSES[armSpec.target]?.[bone]) {
        _qPose.fromArray(POSES[armSpec.target][bone]);
        _q.slerp(_qPose, Math.min(1, Math.max(0, armSpec.w)));
      }

      const rot = p[bone];
      if (rot && (rot[0] || rot[1] || rot[2])) {
        _e.set(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG, 'XYZ');
        _dq.setFromEuler(_e);
        _q.multiply(_dq);
      }
      vals[i * 4] = _q.x; vals[i * 4 + 1] = _q.y; vals[i * 4 + 2] = _q.z; vals[i * 4 + 3] = _q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(bone + '.quaternion', times, vals));
  }

  // Pelvis position track (retains mocap weight-shift + optional crouch offset)
  if (bind.pelvis || basePelvisPosInterp) {
    const vals = new Float32Array(n * 3);
    const p0 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const tBase = (u * baseDur) % Math.max(1e-4, baseDur);
      sampleTrackVec(basePelvisPosInterp, tBase, bind.pelvis?.p, p0);
      const off = poseFn(u)._pelvis || [0, 0, 0];
      vals[i * 3] = p0[0] + off[0];
      vals[i * 3 + 1] = p0[1] + off[1];
      vals[i * 3 + 2] = p0[2] + off[2];
    }
    tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, vals));
  }

  return new THREE.AnimationClip(name, duration, tracks);
}

// ------------------------------------------------------------------------------------------------ poses
// 1. 打哈欠：右手掩口、左手自然舒展，头微仰、胸口深呼吸起伏
function yawn(u) {
  const e = env(u, 0.08, 0.28, 0.64, 0.92);
  const breath = wave(u, 3.5) * 2.5 * e;
  return {
    _armR: { target: 'mouth', w: 0.92 * e },
    _armL: { target: 'chest', w: 0.35 * e },
    spine_01: [-5 * e, 0, 0],
    spine_02: [-6 * e, 0, 0],
    neck_01: [-7 * e, 0, 0],
    head: [(-12 + breath) * e, 4 * e, 0],
    lowerarm_r: [8 * e + breath, 0, 0],
  };
}

// 2. 伸懒腰：双手自然抬起扩胸舒展，随后放松回落
function stretch(u) {
  const up = env(u, 0.06, 0.28, 0.56, 0.88);
  const sway = wave(u, 1.5) * 4 * up;
  return {
    _armL: { target: 'raised', w: 0.88 * up },
    _armR: { target: 'raised', w: 0.88 * up },
    spine_01: [-6 * up, sway * 0.4, 0],
    spine_02: [-7 * up, sway * 0.6, 0],
    neck_01: [-5 * up, 0, 0],
    head: [-9 * up, sway, 0],
  };
}

// 3. 东张西望：保持自然垂臂与呼吸，转头打量两侧街景与招牌
function lookAround(u) {
  const amp = env(u, 0.05, 0.16, 0.84, 0.96);
  const sweep = Math.sin(u * Math.PI * 2 * 0.9) * 36 * amp;
  const lookUp = Math.max(0, Math.sin(u * Math.PI * 2)) * -7 * amp;
  return {
    spine_02: [0, sweep * 0.16, 0],
    spine_03: [0, sweep * 0.12, 0],
    neck_01: [lookUp * 0.4, sweep * 0.35, 0],
    head: [lookUp, sweep * 0.65, 0],
  };
}

// 4. 聊天比划：双手交替在胸前自然比划，配合点头与微侧身
function chat(u) {
  const e = env(u, 0.06, 0.18, 0.82, 0.96);
  const g1 = wave(u, 2.0);
  const g2 = wave(u, 1.5, 0.25);
  return {
    _armR: { target: 'chest', w: (0.72 + 0.18 * g1) * e },
    _armL: { target: 'chest', w: (0.48 - 0.16 * g1) * e },
    spine_01: [2 * e, 3 * g2 * e, 0],
    spine_02: [1 * e, 4 * g2 * e, 0],
    neck_01: [Math.max(0, 4 * g1) * e, 5 * g2 * e, 0],
    head: [(3 + 5 * Math.max(0, g1)) * e, 9 * g2 * e, 2 * g1 * e],
    lowerarm_r: [8 * g1 * e, 0, 0],
    lowerarm_l: [-6 * g1 * e, 0, 0],
  };
}

// 5. 喝水 / 喝茶：右手自然托饮品举到嘴边，头部微仰品尝
function drink(u) {
  const lift = env(u, 0.08, 0.26, 0.72, 0.92);
  const sip = env(u, 0.30, 0.44, 0.62, 0.78);
  return {
    _armR: { target: 'mouth', w: lift },
    spine_01: [1.5 * lift, 0, 0],
    neck_01: [-4 * sip, 0, 0],
    head: [-9 * sip, 0, 0],
    lowerarm_r: [6 * sip, 0, 0],
    hand_r: [-8 * sip, 0, 0],
  };
}

// 6. 吃面（片儿川面摊顾客）：左手胸前捧碗，右手筷子递送到嘴边，微低头品尝
function eat(u) {
  const bow = env(u, 0.06, 0.20, 0.82, 0.96);
  const bite = Math.max(0, wave(u, 2.8)) * bow;
  return {
    _armL: { target: 'chest', w: 0.85 * bow },
    _armR: { target: 'mouth', w: (0.72 + 0.24 * bite) * bow },
    spine_01: [8 * bow, 0, 0],
    spine_02: [5 * bow, 0, 0],
    neck_01: [(6 + 4 * bite) * bow, 0, 0],
    head: [(8 + 5 * bite) * bow, 0, 0],
    lowerarm_r: [10 * bite, 0, 0],
  };
}

// 7. 举手机拍照：右手稳稳举起手机对准前方，左手辅助托持，头部微调取景
function photo(u) {
  const raise = env(u, 0.08, 0.24, 0.74, 0.94);
  const snap = env(u, 0.42, 0.48, 0.54, 0.62);
  return {
    _armR: { target: 'mouth', w: 0.88 * raise },
    _armL: { target: 'chest', w: 0.76 * raise },
    spine_01: [-2 * raise, 0, 0],
    neck_01: [-3 * raise, 0, 0],
    head: [(-2 - 2 * snap) * raise, 3 * raise, 2 * raise],
  };
}

// 8. 招手打招呼：右手自然抬到肩头高度轻轻挥手
function waveHello(u) {
  const e = env(u, 0.06, 0.20, 0.78, 0.95);
  const sway = wave(u, 2.6) * 14 * e;
  return {
    _armR: { target: 'raised', w: 0.85 * e },
    spine_02: [0, -4 * e, 0],
    neck_01: [0, 5 * e, 0],
    head: [-2 * e, 8 * e, 2 * e],
    lowerarm_r: [sway * 0.5, 0, sway * 0.6],
    hand_r: [0, 0, sway],
  };
}

// 9. 看手表 / 看手环：左手抬至胸前，低头查看时间
function checkWatch(u) {
  const e = env(u, 0.08, 0.26, 0.72, 0.94);
  return {
    _armL: { target: 'chest', w: 0.92 * e },
    spine_01: [3 * e, 0, 0],
    neck_01: [6 * e, 5 * e, 0],
    head: [12 * e, 10 * e, 0],
    hand_l: [10 * e, 0, 0],
  };
}

// 10. 俯身查看 / 捡东西：自然微屈膝俯身，右手向下探出
function squatPickup(u) {
  const down = env(u, 0.08, 0.30, 0.58, 0.88);
  return {
    _armR: { target: 'chest', w: 0.55 * down },
    spine_01: [24 * down, 0, 0],
    spine_02: [12 * down, 0, 0],
    neck_01: [6 * down, 0, 0],
    head: [10 * down, 0, 0],
    thigh_l: [-12 * down, 0, 0],
    thigh_r: [-12 * down, 0, 0],
    calf_l: [20 * down, 0, 0],
    calf_r: [20 * down, 0, 0],
    foot_l: [-8 * down, 0, 0],
    foot_r: [-8 * down, 0, 0],
    _pelvis: [0, -0.08 * down, 0.04 * down],
  };
}

// 11. 整理衣领 / 拍肩雨水：左手抬至肩领处轻拍整理
function adjustCollar(u) {
  const e = env(u, 0.08, 0.24, 0.70, 0.92);
  const pat = Math.max(0, wave(u, 2.2)) * e;
  return {
    _armL: { target: 'mouth', w: 0.82 * e },
    spine_01: [2 * e, -3 * e, 0],
    neck_01: [3 * e, -6 * e, 0],
    head: [5 * e, -8 * e, 0],
    lowerarm_l: [8 * pat, 0, 0],
  };
}

export const ACTION_CLIPS = [
  { name: 'yawn', duration: 3.8, pose: yawn },
  { name: 'stretch', duration: 3.6, pose: stretch },
  { name: 'look_around', duration: 5.2, pose: lookAround },
  { name: 'chat', duration: 4.6, pose: chat },
  { name: 'drink', duration: 4.2, pose: drink },
  { name: 'eat', duration: 5.8, pose: eat },
  { name: 'photo', duration: 3.8, pose: photo },
  { name: 'wave_hello', duration: 3.0, pose: waveHello },
  { name: 'check_watch', duration: 3.4, pose: checkWatch },
  { name: 'squat_pickup', duration: 3.6, pose: squatPickup },
  { name: 'adjust_collar', duration: 3.4, pose: adjustCollar },
];

export const IDLE_ACTIONS = ACTION_CLIPS.map((c) => c.name);

/**
 * Build the motion-capture-layered action clips for one rig entry (female / male).
 * @param root THREE.Object3D gltf scene
 * @param baseClips Object<string, THREE.AnimationClip> shipped clips (idle, idle_b, phone_idle, ...)
 */
export function buildActionClips(root, baseClips = {}) {
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const bind = {};
  for (const [k, b] of Object.entries(bones)) bind[k] = { q: b.quaternion.clone(), p: b.position.clone() };
  const idleClip = baseClips.idle || baseClips.idle_b || null;
  const clips = {};
  const durations = {};
  for (const def of ACTION_CLIPS) {
    clips[def.name] = makeClip(def.name, def.duration, def.pose, bind, idleClip);
    durations[def.name] = def.duration;
  }
  return { clips, durations };
}
