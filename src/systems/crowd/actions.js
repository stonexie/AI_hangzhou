// Procedural everyday-action clips authored on the shared 53-bone crowd rig.
//
// The two rig GLBs (female.glb / male.glb) ship 9 locomotion/idle clips. Night-market NPCs also need
// the small, human, everyday beats that sell a crowd: 打哈欠、伸懒腰、东张西望、聊天比划、喝水、吃面、
// 举手机拍照、招手、看手表、蹲下捡东西. Those are generated here as real AnimationClips so they work with
// the existing AnimationMixer path (near LOD) and can be mapped onto a far-LOD VAT clip.
//
// Bone axis convention (calibrated against the shipped rig, character faces +Z):
//   spine_01  X+ = bend forward      head X+ = look down, Y+ = turn left
//   upperarm_l X+ = swing forward,  Z+ = raise outward   (right side is mirrored: Z- = raise outward)
//   lowerarm  X+ = elbow flex
//   thigh     X- = knee forward/lift,  calf X+ = knee bend
import * as THREE from 'three/webgpu';

const DEG = Math.PI / 180;

// every action clip drives all of these so switching clips never leaks a pose from the previous one
const CORE_BONES = [
  'pelvis', 'spine_01', 'spine_02', 'spine_03', 'neck_01', 'head',
  'clavicle_l', 'upperarm_l', 'lowerarm_l', 'hand_l',
  'clavicle_r', 'upperarm_r', 'lowerarm_r', 'hand_r',
  'thigh_l', 'calf_l', 'foot_l', 'thigh_r', 'calf_r', 'foot_r',
];

const smooth = (x) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x); };
// ramp up between a..b, hold, ramp down between c..d
const env = (u, a, b, c, d) => smooth((u - a) / Math.max(1e-5, b - a)) * (1 - smooth((u - c) / Math.max(1e-5, d - c)));
const wave = (u, cycles, phase = 0) => Math.sin((u * cycles + phase) * Math.PI * 2);

const _e = new THREE.Euler(), _dq = new THREE.Quaternion(), _q = new THREE.Quaternion();

// Relaxed resting arms: the rig's bind pose is a wide A-pose, so clips that don't touch the arms would
// leave NPCs standing with splayed arms. Every action gets this baseline adduction added on top.
const REST = {
  upperarm_l: [5, 0, -30], upperarm_r: [5, 0, 30],
  lowerarm_l: [10, 0, 0], lowerarm_r: [10, 0, 0],
};

function makeClip(name, duration, poseFn, bind, fps = 20) {
  const n = Math.max(2, Math.round(duration * fps) + 1);
  const times = new Float32Array(n);
  for (let i = 0; i < n; i++) times[i] = (i / (n - 1)) * duration;
  const tracks = [];
  for (const bone of CORE_BONES) {
    const b = bind[bone];
    if (!b) continue;
    const vals = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      const u = i / (n - 1);
      const pose = poseFn(u);
      const rot = pose[bone] || [0, 0, 0];
      const rest = REST[bone];
      _e.set(
        (rot[0] + (rest ? rest[0] : 0)) * DEG,
        (rot[1] + (rest ? rest[1] : 0)) * DEG,
        (rot[2] + (rest ? rest[2] : 0)) * DEG,
        'XYZ'
      );
      _dq.setFromEuler(_e);
      _q.copy(b.q).multiply(_dq);
      vals[i * 4] = _q.x; vals[i * 4 + 1] = _q.y; vals[i * 4 + 2] = _q.z; vals[i * 4 + 3] = _q.w;
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(bone + '.quaternion', times, vals));
  }
  // optional pelvis bob / squat offset
  if (bind.pelvis) {
    const vals = new Float32Array(n * 3);
    let moved = false;
    for (let i = 0; i < n; i++) {
      const off = poseFn(i / (n - 1))._pelvis || [0, 0, 0];
      if (off[0] || off[1] || off[2]) moved = true;
      vals[i * 3] = bind.pelvis.p.x + off[0];
      vals[i * 3 + 1] = bind.pelvis.p.y + off[1];
      vals[i * 3 + 2] = bind.pelvis.p.z + off[2];
    }
    if (moved) tracks.push(new THREE.VectorKeyframeTrack('pelvis.position', times, vals));
  }
  return new THREE.AnimationClip(name, duration, tracks);
}

// ------------------------------------------------------------------------------------------------ poses
// 打哈欠：双手举过头顶伸展 + 头后仰 + 胸口挺起，末尾带一点放松的回落
function yawn(u) {
  const e = env(u, 0.03, 0.26, 0.58, 0.92);
  const tremble = wave(u, 7) * 2.0 * e;
  const arm = 130 * e;
  return {
    spine_01: [-9 * e, 0, 0],
    spine_02: [-5 * e, 0, 0],
    spine_03: [-3 * e, 0, 0],
    neck_01: [-6 * e, 0, 0],
    head: [-16 * e, 0, 0],
    upperarm_l: [10 * e, 0, arm + tremble],
    upperarm_r: [10 * e, 0, -arm - tremble],
    lowerarm_l: [48 * e + tremble, 0, 0],
    lowerarm_r: [48 * e - tremble, 0, 0],
    _pelvis: [0, 0.01 * e, 0],
  };
}

// 伸懒腰：先向上舒展，再向前含胸舒展腰背
function stretch(u) {
  const up = env(u, 0.02, 0.24, 0.40, 0.62);
  const fold = env(u, 0.60, 0.74, 0.86, 1.0);
  const arm = 104 * up;
  return {
    spine_01: [-10 * up + 18 * fold, 0, 0],
    spine_02: [-6 * up + 10 * fold, 0, 0],
    head: [-10 * up + 12 * fold, 0, 0],
    upperarm_l: [16 * up + 26 * fold, 0, arm],
    upperarm_r: [16 * up + 26 * fold, 0, -arm],
    lowerarm_l: [70 * up + 10 * fold, 0, 0],
    lowerarm_r: [70 * up + 10 * fold, 0, 0],
    _pelvis: [0, -0.02 * fold, 0],
  };
}

// 东张西望：左右看，中间有停顿感
function lookAround(u) {
  const base = Math.sin(u * Math.PI * 2 * 0.85) * 48;
  const amp = env(u, 0.02, 0.10, 0.90, 1.0);
  return {
    head: [-4 * amp, base * amp, 0],
    neck_01: [0, base * 0.28 * amp, 0],
    spine_02: [0, base * 0.10 * amp, 0],
    upperarm_l: [2, 0, 3],
    upperarm_r: [2, 0, -3],
  };
}

// 聊天比划：双手在胸前比划，头部点头回应
function chat(u) {
  const g = wave(u, 2.3);
  const g2 = wave(u, 1.7, 0.3);
  const e = env(u, 0.03, 0.12, 0.88, 0.99);
  return {
    spine_01: [2 + 1.2 * g, 1.5 * g2, 0],
    spine_02: [1, 3 * g2, 0],
    neck_01: [Math.max(0, 3 * g), 4 * g2, 0],
    head: [Math.max(0, 4 * g), 8 * g2, 1.5 * g],
    upperarm_l: [(30 + 9 * g) * e, 0, (20 + 3 * g2) * e],
    upperarm_r: [(30 - 9 * g) * e, 0, -(20 - 3 * g2) * e],
    lowerarm_l: [(62 + 16 * g) * e, 0, 0],
    lowerarm_r: [(62 - 16 * g) * e, 0, 0],
  };
}

// 喝水 / 喝奶茶：右手把杯子送到嘴边，头微微后仰
function drink(u) {
  const lift = env(u, 0.06, 0.22, 0.72, 0.92);
  const sip = env(u, 0.30, 0.42, 0.62, 0.80);
  return {
    spine_01: [1.5 * lift, 0, 0],
    spine_02: [1.0 * lift, 0, 0],
    head: [-10 * sip, 0, 0],
    neck_01: [-4 * sip, 0, 0],
    upperarm_r: [(48 * lift + 4 * sip), 0, (24 * lift)],
    lowerarm_r: [(96 * lift + 6 * sip), 0, 0],
    hand_r: [-10 * lift, 0, 0],
    upperarm_l: [3 * lift, 0, 4],
    lowerarm_l: [10 * lift, 0, 0],
  };
}

// 吃面：低头，右手筷子往返，左手扶着碗
function eat(u) {
  const bow = env(u, 0.04, 0.20, 0.82, 0.99);
  const bite = Math.max(0, wave(u, 3.1)) * bow;
  return {
    spine_01: [13 * bow, 0, 0],
    spine_02: [7 * bow, 0, 0],
    spine_03: [4 * bow, 0, 0],
    neck_01: [6 * bow, 0, 0],
    head: [12 * bow, 0, 0],
    upperarm_r: [(40 * bow + 6 * bite), 0, (20 * bow)],
    lowerarm_r: [(80 * bow + 22 * bite), 0, 0],
    hand_r: [-8 * bow, 0, 0],
    upperarm_l: [34 * bow, 0, (-24 * bow)],
    lowerarm_l: [78 * bow, 0, 0],
    _pelvis: [0, -0.02 * bow, 0],
  };
}

// 举手机拍照：双手抬到胸前面向拍摄对象，头略低
function photo(u) {
  const raise = env(u, 0.05, 0.24, 0.72, 0.94);
  const snap = env(u, 0.40, 0.44, 0.48, 0.56);
  return {
    spine_01: [3 * raise, 0, 0],
    head: [5 * raise - 2 * snap, 0, 0],
    neck_01: [2 * raise, 0, 0],
    upperarm_l: [(38 * raise + 3 * snap), 0, (-12 * raise)],
    upperarm_r: [(38 * raise + 3 * snap), 0, (12 * raise)],
    lowerarm_l: [(92 * raise + 4 * snap), 0, 0],
    lowerarm_r: [(92 * raise + 4 * snap), 0, 0],
    hand_l: [0, 0, 0],
    hand_r: [0, 0, 0],
  };
}

// 招手打招呼：右臂抬起并左右挥动
function waveHello(u) {
  const e = env(u, 0.05, 0.18, 0.80, 0.96);
  const sway = wave(u, 2.8) * 20 * e;
  return {
    spine_02: [0, -4 * e, 0],
    neck_01: [0, 5 * e, 0],
    head: [-2 * e, 7 * e, 0],
    upperarm_r: [(10 * e), 0, (-110 * e)],
    lowerarm_r: [(42 * e), 0, sway],
    hand_r: [0, 0, sway * 1.4],
    upperarm_l: [3, 0, 4],
  };
}

// 看手表 / 看手机时间：左前臂抬起，低头
function checkWatch(u) {
  const e = env(u, 0.06, 0.26, 0.72, 0.94);
  const tap = Math.max(0, wave(u, 2.2)) * e;
  return {
    spine_01: [4 * e, 0, 0],
    neck_01: [5 * e, 0, 0],
    head: [14 * e, -6 * e, 0],
    upperarm_l: [26 * e, 0, (-8 * e)],
    lowerarm_l: [(96 * e + 4 * tap), 0, 0],
    hand_l: [0, 0, -6 * e],
    upperarm_r: [4, 0, -4],
  };
}

// 蹲下捡东西：屈膝下蹲 + 前俯伸手，然后起身
function squatPickup(u) {
  const down = env(u, 0.06, 0.30, 0.56, 0.88);
  return {
    spine_01: [42 * down, 0, 0],
    spine_02: [20 * down, 0, 0],
    spine_03: [8 * down, 0, 0],
    neck_01: [4 * down, 0, 0],
    head: [14 * down, 0, 0],
    thigh_l: [-14 * down, 0, 0],
    thigh_r: [-14 * down, 0, 0],
    calf_l: [22 * down, 0, 0],
    calf_r: [22 * down, 0, 0],
    foot_l: [-8 * down, 0, 0],
    foot_r: [-8 * down, 0, 0],
    upperarm_l: [26 * down, 0, 3 * down],
    upperarm_r: [26 * down, 0, -3 * down],
    lowerarm_l: [18 * down, 0, 0],
    lowerarm_r: [18 * down, 0, 0],
    _pelvis: [0, -0.09 * down, 0.10 * down],
  };
}

// 拍拍肩膀/整理衣领（等人时的小动作）
function adjustCollar(u) {
  const e = env(u, 0.05, 0.22, 0.68, 0.94);
  const tug = Math.max(0, wave(u, 1.6)) * e;
  return {
    spine_01: [2 * e, 0, 0],
    neck_01: [2 * e, 4 * e, 0],
    head: [3 * e, 5 * e, -2 * e],
    upperarm_l: [(30 * e), 0, (-14 * e)],
    lowerarm_l: [(104 * e + 6 * tug), 0, 0],
    hand_l: [0, 0, 12 * tug],
    upperarm_r: [3, 0, -4],
  };
}

export const ACTION_CLIPS = [
  { name: 'yawn', duration: 3.8, pose: yawn },
  { name: 'stretch', duration: 3.4, pose: stretch },
  { name: 'look_around', duration: 5.6, pose: lookAround },
  { name: 'chat', duration: 4.6, pose: chat },
  { name: 'drink', duration: 4.2, pose: drink },
  { name: 'eat', duration: 6.2, pose: eat },
  { name: 'photo', duration: 3.6, pose: photo },
  { name: 'wave_hello', duration: 2.8, pose: waveHello },
  { name: 'check_watch', duration: 3.4, pose: checkWatch },
  { name: 'squat_pickup', duration: 3.8, pose: squatPickup },
  { name: 'adjust_collar', duration: 3.2, pose: adjustCollar },
];

// Clips that are safe to trigger as a spontaneous one-shot while standing around.
export const IDLE_ACTIONS = ACTION_CLIPS.map((c) => c.name);

/**
 * Build the procedural action clips for one rig entry (female / male).
 * @param root THREE.Object3D gltf scene (bind pose, before any mixer runs)
 * @returns {{clips: Object<string, THREE.AnimationClip>, durations: Object<string, number>}}
 */
export function buildActionClips(root) {
  const bones = {};
  root.traverse((o) => { if (o.isBone) bones[o.name] = o; });
  const bind = {};
  for (const [k, b] of Object.entries(bones)) bind[k] = { q: b.quaternion.clone(), p: b.position.clone() };
  const clips = {};
  const durations = {};
  for (const def of ACTION_CLIPS) {
    clips[def.name] = makeClip(def.name, def.duration, def.pose, bind);
    durations[def.name] = def.duration;
  }
  return { clips, durations };
}
