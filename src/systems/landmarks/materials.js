import * as THREE from 'three/webgpu';
import {
  texture, uv, positionWorld, normalWorld, mx_noise_float, vec2, vec3, vec4, float, mix, smoothstep, uniform,
  normalMap, color, clamp, max, min, abs, fract, floor, sin, hash, time, step, dot, normalize, Fn,
} from 'three/tsl';

// Shared uniforms for landmark materials (updated from ctx.weather each frame)
export const U = {
  wet: uniform(1.0),
  lightning: uniform(0.0),
};

const T = 'textures/landmarks/';

// Replaces any Japanese/English text on skyline holo_ads textures with pure Chinese Hangzhou Wulin Night Market banners
function buildChineseLandmarkAd(variant = 0) {
  const W = 1024, H = 1024;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const fSerif = '"Noto Serif SC", "Songti SC", "STSong", "SimSun", serif';
  const fSans = '"Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif';

  g.clearRect(0, 0, W, H);

  const drawCard = (x, y, w, h, bg0, bg1, borderCol, title, sub, badge) => {
    g.save();
    const grd = g.createLinearGradient(x, y, x + w, y + h);
    grd.addColorStop(0, bg0);
    grd.addColorStop(1, bg1);
    g.fillStyle = grd;
    g.fillRect(x, y, w, h);

    g.strokeStyle = borderCol;
    g.lineWidth = 6;
    g.strokeRect(x + 6, y + 6, w - 12, h - 12);
    g.lineWidth = 2;
    g.strokeRect(x + 16, y + 16, w - 32, h - 32);

    // Decorative corner brackets
    g.fillStyle = borderCol;
    const cs = 18;
    g.fillRect(x + 6, y + 6, cs, 4); g.fillRect(x + 6, y + 6, 4, cs);
    g.fillRect(x + w - 6 - cs, y + 6, cs, 4); g.fillRect(x + w - 10, y + 6, 4, cs);
    g.fillRect(x + 6, y + h - 10, cs, 4); g.fillRect(x + 6, y + h - 6 - cs, 4, cs);
    g.fillRect(x + w - 6 - cs, y + h - 10, cs, 4); g.fillRect(x + w - 10, y + h - 6 - cs, 4, cs);

    if (badge) {
      g.fillStyle = '#c83728';
      g.fillRect(x + 28, y + 26, 76, 36);
      g.strokeStyle = '#f5d996';
      g.lineWidth = 1.5;
      g.strokeRect(x + 30, y + 28, 72, 32);
      g.fillStyle = '#fff6e0';
      g.font = `900 20px ${fSerif}`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(badge, x + 66, y + 44);
    }

    g.fillStyle = '#fff5e0';
    g.font = `900 ${Math.min(72, Math.floor((w - 60) / Math.max(2, title.length)))}px ${fSerif}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(title, x + w * 0.5, y + h * 0.46);

    if (sub) {
      g.fillStyle = borderCol;
      g.font = `700 ${Math.min(28, Math.floor((w - 50) / Math.max(4, sub.length)))}px ${fSans}`;
      g.fillText(sub, x + w * 0.5, y + h * 0.76);
    }
    g.restore();
  };

  if (variant === 0) {
    drawCard(24, 24, 468, 290, 'rgba(26, 18, 14, 0.92)', 'rgba(52, 24, 16, 0.92)', '#e8bf6a', '武林夜市', '杭州传统风物夜集', '钱塘');
    drawCard(516, 24, 484, 290, 'rgba(14, 28, 34, 0.92)', 'rgba(20, 46, 54, 0.92)', '#7bd4c8', '西子湖畔', '画舫夜游 · 平湖秋月', '西湖');
    drawCard(24, 340, 620, 310, 'rgba(38, 16, 14, 0.92)', 'rgba(68, 22, 18, 0.92)', '#f2c874', '知味观 · 杭帮名点', '小笼汤包 · 猫耳朵 · 定胜糕', '老字号');
    drawCard(664, 340, 336, 310, 'rgba(18, 26, 20, 0.92)', 'rgba(28, 44, 32, 0.92)', '#98d99c', '狮峰龙井', '雨前新茶 · 江南茗香', '茗茶');
    drawCard(24, 676, 976, 320, 'rgba(22, 16, 28, 0.92)', 'rgba(42, 24, 38, 0.92)', '#f0c472', '钱塘灯会 · 宋韵今辉', '河坊古街 · 南宋御街 · 武林门码头夜市', '杭州');
  } else if (variant === 1) {
    drawCard(24, 24, 976, 300, 'rgba(32, 16, 14, 0.92)', 'rgba(58, 22, 18, 0.92)', '#f2c977', '楼外楼 · 西湖醋鱼', '东坡焖肉 · 龙井虾仁 · 宋嫂鱼羹', '名厨');
    drawCard(24, 350, 476, 310, 'rgba(16, 24, 32, 0.92)', 'rgba(24, 38, 52, 0.92)', '#82c8e6', '都锦生丝绸', '千年织造 · 苏杭云锦', '非遗');
    drawCard(520, 350, 480, 310, 'rgba(28, 20, 14, 0.92)', 'rgba(48, 32, 20, 0.92)', '#e8be6b', '王星记扇庄', '黑纸折扇 · 檀香绢扇', '贡扇');
    drawCard(24, 684, 976, 312, 'rgba(16, 28, 24, 0.92)', 'rgba(24, 46, 38, 0.92)', '#8cd9b8', '奎元老面 · 虾爆鳝面', '江南面王 · 百年高汤 · 现炒浇头', '堂食');
  } else {
    drawCard(24, 24, 480, 460, 'rgba(30, 18, 14, 0.92)', 'rgba(54, 26, 18, 0.92)', '#f0c675', '胡庆余堂', '江南药王 · 戒欺祖训', '国药');
    drawCard(524, 24, 476, 460, 'rgba(16, 24, 30, 0.92)', 'rgba(26, 40, 48, 0.92)', '#84d0d8', '西泠印社', '金石篆刻 · 湖山雅集', '书画');
    drawCard(24, 512, 976, 484, 'rgba(34, 16, 16, 0.92)', 'rgba(62, 22, 20, 0.92)', '#f5cf7e', '杭州武林门 · 运河夜航', '拱宸映月 · 塘栖古镇 · 京杭大运河游船', '夜航');
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export async function loadTextures(ctx) {
  const a = ctx.assets;
  const names = ['concrete', 'stonewall', 'bark'];
  const out = {};
  await Promise.all(names.flatMap((n) => [
    a.texture(T + n + '.png', { srgb: true }).then((t) => (out[n] = t)),
    a.texture(T + n + '_n.png', { srgb: false }).then((t) => (out[n + '_n'] = t)),
    a.texture(T + n + '_r.png', { srgb: false }).then((t) => (out[n + '_r'] = t)),
  ]).concat([
    a.texture(T + 'blossom_cards_a.png', { srgb: true }).then((t) => (out.blossom = t)),
    a.texture(T + 'petals_a.png', { srgb: true }).then((t) => (out.petals = t)),
    a.texture(T + 'wood_slats.png', { srgb: true }).then((t) => (out.wood = t)),
    a.texture(T + 'wood_slats_n.png', { srgb: false }).then((t) => (out.wood_slats_n = t)),
    a.texture(T + 'wood_slats_r.png', { srgb: false }).then((t) => (out.wood_slats_r = t)),
  ]));
  // Pure Chinese Hangzhou cultural banners instead of Japanese holo_ads textures
  out.ads = buildChineseLandmarkAd(0);
  out.ads2 = buildChineseLandmarkAd(1);
  out.ads3 = buildChineseLandmarkAd(2);
  for (const k of ['blossom', 'ads', 'ads2', 'ads3', 'petals']) if (out[k]) { out[k].wrapS = out[k].wrapT = THREE.ClampToEdgeWrapping; }
  return out;
}

// Generic wet PBR surface using world-projected UVs (geometry uv in meters / uvScale).
// opts: map,nmap,rmap textures; tint [r,g,b]; uvScale (multiplier on uv); normalScale; macro (0..1 strength);
// streaks (vertical rain stains); roughMul; wetRough (roughness when soaked, upward faces)
export function surface(tex, opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const s = opts.uvScale ?? 1;
  const uvn = uv().mul(s);
  const tint = vec3(...(opts.tint || [1, 1, 1]));
  const pw = positionWorld;
  const macro = mx_noise_float(pw.mul(opts.macroFreq ?? 0.045)).mul(0.5).add(0.5);
  const macro2 = mx_noise_float(pw.mul(0.21).add(13.1)).mul(0.5).add(0.5);
  let alb = tex.map ? texture(tex.map, uvn).rgb : vec3(0.5);
  // second decorrelated sample at different scale breaks tiling
  if (tex.map && opts.detail !== false) {
    const alb2 = texture(tex.map, uvn.mul(0.37).add(vec2(0.31, 0.77))).rgb;
    alb = mix(alb, alb2, smoothstep(0.35, 0.65, macro2).mul(0.5));
  }
  const macroAmt = float(opts.macro ?? 0.5);
  let col = alb.mul(tint).mul(mix(float(1), mix(0.55, 1.25, macro), macroAmt));
  // vertical rain streaks / grime on vertical faces
  const vert = float(1).sub(abs(normalWorld.y));
  if (opts.streaks !== false) {
    const sk = mx_noise_float(vec3(pw.x.add(pw.z).mul(2.3), pw.y.mul(0.12), 1.7)).mul(0.5).add(0.5);
    col = col.mul(mix(float(1), mix(0.55, 1.05, sk), vert.mul(opts.streaks ?? 0.7)));
  }
  const wet = U.wet;
  const up = clamp(normalWorld.y, 0, 1);
  // wet darkening
  col = col.mul(mix(float(1), float(opts.wetDark ?? 0.62), wet));
  m.colorNode = col;
  const baseR = tex.rmap ? texture(tex.rmap, uvn).r.mul(opts.roughMul ?? 1) : float(opts.rough ?? 0.8);
  const soak = wet.mul(mix(float(opts.wetVert ?? 0.45), float(1), up)).mul(mix(0.6, 1.0, macro2));
  m.roughnessNode = clamp(mix(baseR, baseR.mul(0.3).add(opts.wetRough ?? 0.06), soak), 0.03, 1);
  m.metalnessNode = float(opts.metal ?? 0);
  if (tex.nmap) {
    m.normalNode = normalMap(texture(tex.nmap, uvn), vec2(opts.normalScale ?? 1, opts.normalScale ?? 1));
  }
  if (opts.emissive) m.emissiveNode = opts.emissive;
  return m;
}

// Painted / bare metal without textures, with procedural grime
export function metal(opts = {}) {
  const m = new THREE.MeshStandardNodeMaterial();
  const pw = positionWorld;
  const n = mx_noise_float(pw.mul(opts.freq ?? 0.8)).mul(0.5).add(0.5);
  const n2 = mx_noise_float(pw.mul(6.0)).mul(0.5).add(0.5);
  const c = vec3(...(opts.color || [0.2, 0.2, 0.22]));
  m.colorNode = c.mul(mix(0.6, 1.15, n)).mul(mix(0.85, 1.05, n2)).mul(mix(float(1), 0.75, U.wet));
  const r = opts.rough ?? 0.45;
  m.roughnessNode = clamp(mix(float(r), float(r * 0.45), U.wet).add(n2.sub(0.5).mul(0.2)), 0.05, 1);
  m.metalnessNode = float(opts.metal ?? 0.85);
  return m;
}

export function emissiveMat(rgb, intensity = 3) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(0.02);
  m.roughnessNode = float(0.4);
  m.metalnessNode = float(0);
  m.emissiveNode = vec3(...rgb).mul(intensity);
  return m;
}

export function glassMat(rgb = [0.6, 0.85, 1.0], emissive = 1.5) {
  const m = new THREE.MeshStandardNodeMaterial();
  m.colorNode = vec3(...rgb).mul(0.2);
  m.roughnessNode = float(0.08);
  m.metalnessNode = float(0.9);
  m.emissiveNode = vec3(...rgb).mul(emissive);
  return m;
}
