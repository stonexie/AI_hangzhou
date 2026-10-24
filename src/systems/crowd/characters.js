// Character library: loads crowd GLBs (male/female) with rich, multi-textured modern Chinese urban & Jiangnan fashion
// (连帽卫衣、城市户外冲锋衣、休闲丹宁夹克、卡其风衣、格纹衬衫、灯芯绒外套、宋锦暗纹穿搭、T恤牛仔裤、运动鞋、智能手机与现代晴雨伞),
// builds physical/node materials with procedural fabric weaves (格纹/条纹/斜纹/针织/提花光泽/防雨涂层),
// and produces SkeletonUtils clones for NPCs / player.
import * as THREE from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4, uniform, mix, clamp, normalWorld, positionWorld, cameraPosition,
  texture, uv, sin, cos, fract, floor, smoothstep, step, dot, normalize, abs,
} from 'three/tsl';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  applyHanfuToEntry,
  getWestLakeUmbrellaTexture,
} from './hanfu.js';

export const CROWD_U = {
  wetness: uniform(1.0),
  rain: uniform(1.0),
  lightning: uniform(0.0),
};

const ACCESSORIES = ['umbrella_black', 'umbrella_clear', 'umbrella_led', 'phone'];

// Rich per-material tint palettes for base clothing, footwear, belts, skin undertones & natural modern Chinese hair
const PALETTES = {
  cloth_msuit: [
    [0.95, 0.96, 0.98], // 清爽白牛津纺衬衫配深蓝长裤
    [0.72, 0.82, 0.92], // 雾霾蓝休闲衬衫
    [0.92, 0.88, 0.80], // 燕麦亚麻色休闲装
    [0.74, 0.84, 0.78], // 龙泉青瓷绿日常装
    [0.86, 0.76, 0.72], // 暖灰豆沙休闲衬衫
    [0.64, 0.70, 0.78], // 远山黛蓝衬衫
    [0.90, 0.82, 0.68], // 暖杏米黄休闲衫
    [0.58, 0.64, 0.60], // 竹影灰绿休闲装
  ],
  cloth_mjacket: [
    [1.00, 1.00, 1.00], // 经典原色夹克配复古牛仔裤
    [0.72, 0.82, 0.96], // 冰川丹宁蓝夹克
    [0.94, 0.84, 0.70], // 暖卡其工装夹克
    [0.72, 0.82, 0.74], // 山系松石绿夹克
    [0.86, 0.64, 0.56], // 陶土赤褐灯芯绒夹克
    [0.64, 0.68, 0.76], // 岩灰蓝防风夹克
    [0.88, 0.76, 0.82], // 烟灰紫休闲外套
    [0.78, 0.72, 0.62], // 美拉德摩卡夹克
  ],
  cloth_mshirt: [
    [1.00, 1.00, 1.00], // 现代日常格纹/纯色衬衫休闲裤
    [0.76, 0.88, 0.98], // 浅冰蓝日常衬衫
    [0.95, 0.90, 0.80], // 杏仁米白日常衬衫
    [0.78, 0.88, 0.82], // 薄荷青灰衬衫
    [0.92, 0.78, 0.74], // 珊瑚暖粉休闲衬衫
    [0.68, 0.74, 0.84], // 丹宁水洗蓝衬衫
    [0.86, 0.82, 0.72], // 亚麻燕麦色衬衫
    [0.74, 0.76, 0.80], // 银灰格纹衬衫
  ],
  cloth_mtee: [
    [1.00, 1.00, 1.00], // 现代纯白重磅T恤配休闲裤
    [0.78, 0.86, 0.96], // 冰川灰蓝T恤
    [0.95, 0.88, 0.76], // 杏仁暖米T恤
    [0.74, 0.86, 0.80], // 豆蔻青绿T恤
    [0.92, 0.74, 0.72], // 落日橘粉T恤
    [0.62, 0.66, 0.72], // 炭灰街头T恤
    [0.86, 0.80, 0.92], // 浅芋紫潮流T恤
    [0.90, 0.86, 0.66], // 桂花暖黄T恤
  ],
  cloth_felegant: [
    [1.00, 1.00, 1.00], // 现代都市轻熟风上衣配长裤
    [0.96, 0.82, 0.86], // 浅茱萸粉真丝感上衣
    [0.78, 0.88, 0.96], // 清新天青蓝日常穿搭
    [0.96, 0.90, 0.78], // 奶油香槟杏色穿搭
    [0.80, 0.90, 0.84], // 江南柳芽绿穿搭
    [0.88, 0.80, 0.94], // 丁香淡紫知性穿搭
    [0.92, 0.74, 0.68], // 暖橘茶色针织穿搭
    [0.76, 0.82, 0.86], // 雾霭灰蓝通勤穿搭
  ],
  cloth_fcasual: [
    [1.00, 1.00, 1.00], // 经典白T恤配复古蓝牛仔裤
    [0.82, 0.90, 1.00], // 冰蓝针织T恤配牛仔裤
    [0.98, 0.82, 0.86], // 樱花粉上衣配牛仔裤
    [0.80, 0.94, 0.86], // 薄荷绿上衣配牛仔裤
    [0.96, 0.90, 0.76], // 奶杏色上衣配牛仔裤
    [0.88, 0.80, 0.96], // 香芋紫短袖配牛仔裤
    [0.94, 0.76, 0.68], // 蜜桃珊瑚色上衣配牛仔裤
    [0.74, 0.86, 0.90], // 西湖水碧色上衣配牛仔裤
  ],
  cloth_fsport: [
    [1.00, 1.00, 1.00], // 现代运动休闲套装
    [0.78, 0.88, 0.96], // 雾霾蓝运动休闲套装
    [0.94, 0.88, 0.82], // 燕麦奶咖运动卫裤
    [0.78, 0.90, 0.84], // 鼠尾草绿瑜伽运动装
    [0.96, 0.80, 0.84], // 甜心粉白拼色运动装
    [0.84, 0.78, 0.92], // 薰衣草紫运动休闲装
    [0.72, 0.76, 0.82], // 极地冷灰运动套装
    [0.94, 0.86, 0.68], // 活力鹅黄休闲运动装
  ],
  shoes_black: [
    [0.22, 0.22, 0.24], // 炭黑休闲皮鞋/板鞋
    [0.38, 0.28, 0.22], // 深摩卡棕工装鞋
    [0.26, 0.32, 0.40], // 深藏蓝麂皮休闲鞋
    [0.48, 0.44, 0.40], // 暖灰褐复古休闲鞋
  ],
  shoes_sneaker: [
    [0.96, 0.95, 0.92], // 经典米白复古跑鞋
    [0.78, 0.86, 0.94], // 冰蓝拼色老爹鞋
    [0.90, 0.78, 0.74], // 灰粉拼色滑板鞋
    [0.76, 0.84, 0.78], // 抹茶绿拼色运动鞋
    [0.86, 0.80, 0.68], // 卡其沙漠色运动鞋
  ],
  shoes_white: [
    [0.96, 0.96, 0.95], // 纯白经典小白鞋
    [0.92, 0.90, 0.84], // 奶油米白板鞋
    [0.86, 0.90, 0.94], // 冷调灰白运动鞋
    [0.94, 0.86, 0.86], // 樱花白粉板鞋
  ],
  shoes_blue: [
    [0.52, 0.68, 0.88], // 丹宁蓝帆布鞋
    [0.88, 0.76, 0.82], // 莓果粉休闲运动鞋
    [0.64, 0.82, 0.76], // 薄荷青运动鞋
    [0.86, 0.82, 0.74], // 燕麦奶茶色休闲鞋
  ],
  shoes_dark: [
    [0.24, 0.24, 0.26], // 经典哑光黑乐福鞋
    [0.42, 0.30, 0.24], // 复古栗棕小皮鞋
    [0.52, 0.22, 0.24], // 酒红漆皮玛丽珍鞋
    [0.76, 0.72, 0.66], // 奶油杏色短靴
  ],
  skin: [
    [1.02, 0.98, 0.96], // 白皙冷调肤色
    [1.00, 0.96, 0.93], // 自然暖白肤色
    [0.98, 0.93, 0.89], // 健康小麦暖肤色
    [1.01, 0.95, 0.94], // 粉润自然肤色
  ],
  // Authentic modern Chinese hair colors (natural black, espresso brown, warm chestnut, dark tea brown, caramel)
  hair: [
    [0.050, 0.046, 0.045], // 自然纯黑发
    [0.072, 0.060, 0.054], // 柔和自然黑
    [0.115, 0.082, 0.062], // 冷茶棕染发
    [0.045, 0.042, 0.044], // 乌黑亮泽发色
    [0.155, 0.105, 0.076], // 摩卡栗棕（现代青年常见染发）
    [0.065, 0.056, 0.052], // 深炭黑
    [0.095, 0.072, 0.058], // 黑茶色
    [0.180, 0.122, 0.088], // 焦糖茶棕
    [0.130, 0.078, 0.072], // 暖红棕/板栗染发
  ],
};

// Rich linear colours for modern Chinese urban outerwear (hoodies, windbreakers/冲锋衣, trench coats, casual skirts)
const GARMENT = {
  rain_black: [
    [0.18, 0.24, 0.34], // 深海藏青三合一防风衣
    [0.26, 0.34, 0.28], // 山系松林绿户外冲锋衣
    [0.44, 0.38, 0.32], // 暖灰褐机能风衣
    [0.16, 0.18, 0.21], // 曜石炭灰连帽防雨衣
    [0.48, 0.22, 0.24], // 勃艮第酒红防风外套
    [0.32, 0.42, 0.48], // 烟雨青灰户外夹克
    [0.64, 0.56, 0.46], // 沙漠卡其防风外套
    [0.24, 0.22, 0.32], // 暗夜墨紫防雨夹克
  ],
  rain_red: [
    [0.86, 0.78, 0.68], // 奶油杏色短款防风夹克
    [0.46, 0.62, 0.78], // 雾霾冰蓝短款冲锋衣
    [0.74, 0.24, 0.28], // 朱砂树莓红休闲外套
    [0.54, 0.70, 0.62], // 豆蔻青瓷绿短外套
    [0.82, 0.58, 0.64], // 干枯玫瑰粉防风衣
    [0.68, 0.58, 0.78], // 香芋丁香紫短夹克
    [0.84, 0.66, 0.38], // 秋叶姜黄亮面外套
    [0.28, 0.36, 0.46], // 海军蓝短款夹克
  ],
  trench_tan: [
    [0.68, 0.58, 0.44], // 经典巴尔马肯卡其风衣
    [0.46, 0.38, 0.30], // 摩卡焦糖驼色羊毛大衣
    [0.30, 0.36, 0.44], // 雾灰蓝斜纹都市风衣
    [0.76, 0.72, 0.64], // 燕麦米白双排扣风衣
    [0.32, 0.38, 0.32], // 复古军绿猎装风衣
    [0.22, 0.23, 0.26], // 经典深炭灰呢子大衣
    [0.52, 0.32, 0.28], // 铁锈红棕格纹大衣
    [0.58, 0.54, 0.50], // 高级暖鸽灰长款风衣
  ],
  trench_tan_belt: [
    [0.28, 0.22, 0.16], // 深棕牛皮腰带
    [0.16, 0.16, 0.18], // 哑光黑皮质腰带
    [0.48, 0.38, 0.28], // 琥珀棕编织腰带
    [0.38, 0.34, 0.30], // 灰褐同色系束带
  ],
  trench_beige: [
    [0.84, 0.76, 0.64], // 燕麦奶茶色女士垂感风衣
    [0.72, 0.62, 0.48], // 经典浅驼色羊毛大衣
    [0.62, 0.70, 0.78], // 冰川灰蓝韩系风衣
    [0.82, 0.68, 0.70], // 浅藕粉双面呢大衣
    [0.64, 0.74, 0.68], // 江南竹青色风衣
    [0.88, 0.84, 0.78], // 象牙奶油白长款大衣
    [0.54, 0.42, 0.36], // 肉桂摩卡棕风衣
    [0.70, 0.64, 0.76], // 烟霞紫灰气质大衣
  ],
  trench_beige_belt: [
    [0.36, 0.26, 0.20], // 焦糖棕皮质腰带
    [0.62, 0.52, 0.42], // 奶茶同色系束带
    [0.20, 0.19, 0.20], // 经典黑细腰带
    [0.52, 0.40, 0.38], // 玫瑰棕腰带
  ],
  tech_black: [
    [0.22, 0.28, 0.34], // 深岩灰城市户外冲锋衣
    [0.26, 0.36, 0.28], // 山系旷野绿拼色冲锋衣
    [0.68, 0.62, 0.52], // 沙漠卡其山系冲锋衣
    [0.18, 0.26, 0.40], // 深海藏蓝机能运动外套
    [0.58, 0.26, 0.24], // 丹霞赤红登山冲锋衣
    [0.74, 0.76, 0.78], // 冰川银灰拼接防风衣
    [0.42, 0.34, 0.28], // 岩石咖啡棕户外夹克
    [0.28, 0.42, 0.44], // 远山青黛冲锋衣
  ],
  tech_white: [
    [0.90, 0.91, 0.93], // 冰川白防晒衣/户外夹克
    [0.66, 0.78, 0.88], // 冰晶蓝拼色运动冲锋衣
    [0.90, 0.72, 0.76], // 贝壳樱粉户外防风衣
    [0.70, 0.84, 0.76], // 薄荷奶绿山系外套
    [0.88, 0.82, 0.68], // 奶油杏黄休闲冲锋衣
    [0.76, 0.70, 0.86], // 丁香紫拼色防晒夹克
    [0.62, 0.74, 0.74], // 天青瓷色轻薄冲锋衣
    [0.86, 0.68, 0.58], // 暖杏珊瑚色运动外套
  ],
  knit_charcoal: [
    [0.48, 0.50, 0.54], // 高级麻灰重磅连帽卫衣
    [0.86, 0.83, 0.76], // 燕麦杏白圆领针织卫衣
    [0.20, 0.28, 0.40], // 学院藏青连帽卫衣
    [0.36, 0.46, 0.38], // 鼠尾草绿华夫格卫衣
    [0.56, 0.24, 0.26], // 复古酒红重磅卫衣
    [0.58, 0.46, 0.36], // 焦糖摩卡针织连帽衫
    [0.38, 0.48, 0.58], // 雾霾丹宁蓝卫衣
    [0.74, 0.64, 0.42], // 姜黄复古街头卫衣
  ],
  knit_grey: [
    [0.88, 0.84, 0.78], // 燕麦奶白女士羊绒感卫衣
    [0.58, 0.70, 0.84], // 海盐雾霾蓝针织毛衣
    [0.88, 0.68, 0.72], // 浅樱桃粉软糯卫衣
    [0.64, 0.78, 0.68], // 抹茶奶绿针织开衫
    [0.76, 0.68, 0.84], // 香芋紫麻花针织衫
    [0.86, 0.74, 0.56], // 杏仁奶黄慵懒毛衣
    [0.68, 0.30, 0.32], // 新中式朱砂红针织衫
    [0.46, 0.54, 0.56], // 烟雨青灰针织卫衣
  ],
  skirt_black: [
    [0.20, 0.28, 0.42], // 复古丹宁牛仔半身裙
    [0.22, 0.23, 0.26], // 炭灰学院风百褶裙
    [0.72, 0.64, 0.54], // 卡其苏格兰格纹裙
    [0.84, 0.80, 0.74], // 奶油白垂感丝缎半裙
    [0.48, 0.24, 0.26], // 勃艮第酒红灯芯绒半裙
    [0.34, 0.42, 0.36], // 森系松绿格纹半身裙
    [0.54, 0.42, 0.34], // 美拉德棕百褶裙
  ],
  tights_black: [
    [0.82, 0.68, 0.58], // 自然肤色丝绒感打底袜
    [0.16, 0.17, 0.19], // 现代哑光黑色修身打底裤
    [0.24, 0.22, 0.21], // 摩卡透肉感黑茶丝袜
    [0.76, 0.62, 0.52], // 暖调裸感丝袜
  ],
  boots_black: [
    [0.86, 0.83, 0.78], // 现代米白厚底切尔西靴
    [0.14, 0.14, 0.15], // 经典亮面小牛皮黑马丁靴
    [0.38, 0.25, 0.18], // 美拉德复古棕马丁靴
    [0.46, 0.20, 0.20], // 酒红擦色皮短靴
    [0.56, 0.48, 0.40], // 麂皮沙色沙漠靴
  ],
  // Clean non-glowing modern metallic & woven zipper/piping trims (brushed silver, champagne gold, bronze, gunmetal)
  trim_cyan: [
    [0.84, 0.86, 0.88], // 拉丝银金属拉链
    [0.78, 0.70, 0.54], // 香槟金五金饰条
    [0.26, 0.30, 0.34], // 枪灰哑光压胶条
    [0.62, 0.48, 0.38], // 古铜五金扣件
  ],
  trim_magenta: [
    [0.90, 0.86, 0.80], // 珍珠白撞色滚边
    [0.80, 0.68, 0.52], // 暖金金属拉链
    [0.34, 0.36, 0.40], // 深灰反光织带
    [0.68, 0.44, 0.42], // 玫瑰金饰扣
  ],
};

// Secondary accent / pattern weave / lower-garment palettes so NPCs have rich multi-tone fabrics
const ACCENT_PALETTE = [
  [0.22, 0.28, 0.38], // 深丹宁靛蓝
  [0.86, 0.82, 0.74], // 燕麦亚麻白
  [0.32, 0.38, 0.34], // 江南竹青灰
  [0.58, 0.32, 0.28], // 赭石赤茶色
  [0.68, 0.58, 0.46], // 暖驼卡其色
  [0.24, 0.25, 0.28], // 曜石炭黑色
  [0.54, 0.66, 0.76], // 水洗雾霾蓝
  [0.76, 0.64, 0.68], // 烟灰茱萸粉
];

// Fabric detail textures: knit, twill, ripstop nylon, and glossy PVC/leather grain
const FABRIC = {
  rain:   ['fab_pvc',   9, 0.42],
  trench: ['fab_twill', 11, 0.58],
  tech:   ['fab_nylon', 10, 0.48],
  knit:   ['fab_knit',  12, 0.68],
  skirt:  ['fab_twill', 11, 0.52],
  boots:  ['fab_pvc',   8, 0.38],
  cloth:  ['fab_twill', 12, 0.36],
  shoes:  ['fab_nylon', 9, 0.32],
};

function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Synthesize a "抱头小跑" (Covering-Head Rain Jog) AnimationClip from `walk_fast`:
// Keeps all lower-body & root running tracks from `walk_fast` and replaces upper-body/arm tracks
// so both hands are raised above the head to shield from the rain with a natural 2-beat jogging bounce.
function buildCoverRunClip(walkFastClip) {
  if (!walkFastClip) return null;
  const clip = walkFastClip.clone();
  clip.name = 'cover_run';
  const d = clip.duration || 0.95;
  const times = new Float32Array([0, d * 0.25, d * 0.5, d * 0.75, d]);

  const upperOverrides = new Set([
    'spine_02.quaternion', 'spine_03.quaternion', 'neck_01.quaternion', 'head.quaternion',
    'clavicle_l.quaternion', 'upperarm_l.quaternion', 'lowerarm_l.quaternion', 'hand_l.quaternion',
    'clavicle_r.quaternion', 'upperarm_r.quaternion', 'lowerarm_r.quaternion', 'hand_r.quaternion',
  ]);
  clip.tracks = clip.tracks.filter((tr) => !upperOverrides.has(tr.name));

  const qTrack = (boneName, baseQ, bobEulerA, bobEulerB) => {
    const q0 = new THREE.Quaternion().fromArray(baseQ);
    const dA = new THREE.Quaternion().setFromEuler(new THREE.Euler(...bobEulerA));
    const dB = new THREE.Quaternion().setFromEuler(new THREE.Euler(...bobEulerB));
    const qA = q0.clone().multiply(dA);
    const qB = q0.clone().multiply(dB);
    const seq = [qA, qB, qA, qB, qA];
    const vals = new Float32Array(seq.length * 4);
    seq.forEach((q, i) => q.toArray(vals, i * 4));
    return new THREE.QuaternionKeyframeTrack(`${boneName}.quaternion`, times, vals);
  };

  // Forward rain crouch on spine & neck, hands raised above head (`hand_l` & `hand_r` at y ~ 1.72m over head)
  clip.tracks.push(
    qTrack('spine_02',   [-0.0875, 0, 0, 0.9962],       [ 0.03,  0.03, 0], [-0.02, -0.03, 0]),
    qTrack('spine_03',   [ 0.0450, 0, 0, 0.9990],       [ 0.02, -0.02, 0], [-0.02,  0.02, 0]),
    qTrack('neck_01',    [ 0.3293, 0, 0, 0.9442],       [ 0.03,  0.00, 0], [-0.03,  0.00, 0]),
    qTrack('head',       [-0.2034, 0, 0, 0.9791],       [-0.02,  0.03, 0], [ 0.02, -0.03, 0]),
    qTrack('clavicle_l', [ 0.0110, 0.0470, -0.7580, 0.6510], [0, 0,  0.03], [0, 0, -0.02]),
    qTrack('upperarm_l', [ 0.5691, -0.1560, 0.2441, 0.7695], [ 0.05, 0.02,  0.03], [-0.04, -0.02, -0.03]),
    qTrack('lowerarm_l', [ 0.3611,  0.0939, 0.6887, 0.6216], [ 0.04, 0.00,  0.02], [-0.04,  0.00, -0.02]),
    qTrack('hand_l',     [ 0.3726,  0.0000, -0.3822, 0.8456], [0.02, 0, 0], [-0.02, 0, 0]),
    qTrack('clavicle_r', [ 0.0110, -0.0470,  0.7580, 0.6510], [0, 0, -0.02], [0, 0,  0.03]),
    qTrack('upperarm_r', [ 0.5691,  0.1560, -0.2441, 0.7695], [-0.04, 0.02,  0.03], [ 0.05, -0.02, -0.03]),
    qTrack('lowerarm_r', [ 0.3611, -0.0939, -0.6887, 0.6216], [-0.04, 0.00, -0.02], [ 0.04,  0.00,  0.02]),
    qTrack('hand_r',     [ 0.3726,  0.0000,  0.3822, 0.8456], [-0.02, 0, 0], [0.02, 0, 0]),
  );
  return clip;
}

export class CharacterLibrary {
  constructor(ctx) {
    this.ctx = ctx;
    this.sexes = {}; // sex -> { gltf, meta, templates: {outfit: Object3D}, clips: {name: AnimationClip} }
    this.matCache = new Map();
    this.textures = new Map();
  }

  async load() {
    const ctx = this.ctx;
    const load = async (sex) => {
      const [gltf, meta] = await Promise.all([
        ctx.assets.gltf(`models/crowd/${sex}.glb`),
        fetch(`/models/crowd/${sex}.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!gltf || !meta) return;
      await this.prepareTextures(meta);
      const clips = {};
      for (const c of gltf.animations) clips[c.name] = c;
      const coverRun = buildCoverRunClip(clips.walk_fast);
      if (coverRun) {
        clips.cover_run = coverRun;
        if (meta.clips?.walk_fast) {
          meta.clips.cover_run = {
            period: meta.clips.walk_fast.period,
            speed: meta.clips.walk_fast.speed * 1.06,
            frames: meta.clips.walk_fast.frames,
          };
        }
      }
      const entry = { sex, gltf, meta, clips, templates: {}, lodTemplates: {}, outfits: Object.keys(meta.outfits) };
      this.sexes[sex] = entry;
      this.buildTemplates(entry);
    };
    await Promise.all([...['male', 'female'].map(load), this.loadFabrics()]);
    this.outfitList = [];
    for (const s of Object.values(this.sexes)) for (const o of s.outfits) this.outfitList.push({ sex: s.sex, outfit: o });
    return this.outfitList.length > 0;
  }

  async prepareTextures(meta) {
    const jobs = [];
    for (const [mname, t] of Object.entries(meta.textures || {})) {
      // Skip only formal male necktie suit texture (remapped to casual shirt); load all other diffuse & normal maps
      if (mname === 'cloth_msuit') continue;
      for (const [slot, path] of Object.entries(t)) {
        if (this.textures.has(path)) continue;
        const p = this.ctx.assets.texture(path, { srgb: slot === 'map' }).then((tex) => {
          if (tex) { tex.flipY = false; tex.anisotropy = 8; tex.needsUpdate = true; }
          this.textures.set(path, tex);
        });
        this.textures.set(path, null);
        jobs.push(p);
      }
    }
    await Promise.all(jobs);
  }

  // ------------------------------------------------------------------------------------------ materials
  tintFor(name, meta, tintIdx) {
    const kind = name.startsWith('hair') ? 'hair' : name;
    const gpal = GARMENT[name];
    if (gpal) {
      const c = gpal[tintIdx % gpal.length];
      return new THREE.Color(c[0], c[1], c[2]);
    }
    const pal = PALETTES[kind];
    if (pal) {
      const c = pal[tintIdx % pal.length];
      return new THREE.Color(c[0], c[1], c[2]);
    }
    if (name === 'phone_body') {
      const pCols = [[0.18, 0.20, 0.23], [0.78, 0.75, 0.70], [0.24, 0.30, 0.36], [0.68, 0.56, 0.58]];
      const c = pCols[tintIdx % pCols.length];
      return new THREE.Color(c[0], c[1], c[2]);
    }
    if (name === 'phone_screen') {
      return new THREE.Color(0.82, 0.90, 1.0);
    }
    if (name === 'umb_handle' || name === 'umb_metal') {
      return new THREE.Color(0.28, 0.24, 0.20);
    }
    if (name.startsWith('umb_')) {
      return new THREE.Color(1, 1, 1);
    }
    const tex = meta.textures?.[name];
    if (tex?.map) return new THREE.Color(1, 1, 1);
    const mm = meta.materials?.[name];
    const c = mm?.color || [1, 1, 1];
    return new THREE.Color(c[0], c[1], c[2]);
  }

  accentFor(name, tintIdx) {
    const c = ACCENT_PALETTE[(tintIdx * 3 + hashStr(name)) % ACCENT_PALETTE.length];
    return new THREE.Color(c[0], c[1], c[2]);
  }

  // Per-character material style vector:
  // x = procedural pattern mode (0: micro-weave, 1: tartan/plaid check, 2: corduroy/vertical rib, 3: Breton/horizontal stripe, 4: Jiangnan brocade/jacquard sheen)
  // y = pattern contrast strength (0..0.38)
  // z = velvet/silk/wool Fresnel rim sheen strength (0..0.45)
  // w = roughness offset (-0.18..+0.12)
  styleFor(name, seed) {
    const prefix = name.split('_')[0];
    const h = (seed * 2654435761 + hashStr(name)) >>> 0;
    const patRoll = h % 10;
    if (prefix === 'trench' || prefix === 'skirt') {
      // Trench coats & skirts: wool twill, Scottish plaid/check, corduroy, or cashmere sheen
      const mode = patRoll < 4 ? 1 : patRoll < 6 ? 2 : patRoll < 8 ? 4 : 0;
      const strength = mode === 1 ? 0.26 : mode === 2 ? 0.20 : mode === 4 ? 0.22 : 0.08;
      return new THREE.Vector4(mode, strength, 0.34, -0.04);
    }
    if (prefix === 'knit') {
      // Hoodies & knitwear: cable/ribbed knit, horizontal stripe, color-block weave, soft fleece sheen
      const mode = patRoll < 3 ? 3 : patRoll < 6 ? 2 : patRoll < 8 ? 1 : 0;
      const strength = mode === 3 ? 0.24 : mode === 2 ? 0.18 : mode === 1 ? 0.20 : 0.10;
      return new THREE.Vector4(mode, strength, 0.38, 0.06);
    }
    if (prefix === 'rain' || prefix === 'tech') {
      // Raincoats & techwear: ripstop grid, sleek coated shell, or subtle geometric jacquard
      const mode = patRoll < 3 ? 1 : patRoll < 6 ? 4 : 0;
      const strength = mode === 1 ? 0.16 : mode === 4 ? 0.20 : 0.08;
      return new THREE.Vector4(mode, strength, 0.22, -0.14);
    }
    if (prefix === 'cloth') {
      // Shirts, jackets, tees, casual/elegant tops: plaid shirts, striped tees, corduroy jackets, silk/satin blouses
      const mode = patRoll < 3 ? 1 : patRoll < 5 ? 3 : patRoll < 7 ? 2 : patRoll < 9 ? 4 : 0;
      const strength = mode === 0 ? 0.06 : 0.22;
      return new THREE.Vector4(mode, strength, 0.28, -0.03);
    }
    if (prefix === 'boots' || prefix === 'shoes') {
      return new THREE.Vector4(0, 0.08, 0.18, -0.12);
    }
    return new THREE.Vector4(0, 0, 0.08, 0);
  }

  material(name, meta) {
    if (this.matCache.has(name)) return this.matCache.get(name);
    const mm = meta.materials?.[name] || {};
    // Remap formal male business suit (`cloth_msuit`) to casual shirt/jeans so no NPC wears an office necktie
    const lookupName = name === 'cloth_msuit' ? 'cloth_mshirt' : name;
    const tex = meta.textures?.[lookupName] || meta.textures?.[name] || {};
    const prefix = name.split('_')[0];
    const isCloth = prefix === 'cloth';
    const isGarment = isCloth || prefix === 'rain' || prefix === 'trench' || prefix === 'tech' || prefix === 'knit' || prefix === 'skirt';
    const isFootwear = prefix === 'boots' || prefix === 'shoes' || name === 'sole';
    const isBelt = name.endsWith('_belt');
    const isTrim = prefix === 'trim';

    let map = null;
    let nmap = null;
    if (name === 'umb_clear') {
      map = getWestLakeUmbrellaTexture('clear');
    } else if (name === 'umb_black') {
      map = getWestLakeUmbrellaTexture('black');
    } else if (name === 'umb_ledcanopy' || name === 'umb_led') {
      map = getWestLakeUmbrellaTexture('led');
    } else {
      map = tex.map ? this.textures.get(tex.map) : null;
      nmap = tex.normal ? this.textures.get(tex.normal) : null;
    }

    const kind = name.startsWith('hair') ? 'hair' : name;
    const W = CROWD_U.wetness;
    const isUmbrella = name.startsWith('umb_');
    const isCoated = isUmbrella || prefix === 'rain' || prefix === 'boots' || isBelt;

    const tintU = uniform(new THREE.Color(1, 1, 1)).onObjectUpdate(({ object }) => object.userData.tint || new THREE.Color(1, 1, 1));
    const tint2U = uniform(new THREE.Color(1, 1, 1)).onObjectUpdate(({ object }) => object.userData.tint2 || object.userData.tint || new THREE.Color(1, 1, 1));
    const styleU = uniform(new THREE.Vector4(0, 0, 0.15, 0)).onObjectUpdate(({ object }) => object.userData.styleVec || new THREE.Vector4(0, 0, 0.15, 0));

    let m;
    if (isCoated) {
      m = new THREE.MeshPhysicalNodeMaterial({
        roughness: name === 'umb_clear' ? 0.14 : prefix === 'rain' ? 0.26 : prefix === 'boots' ? 0.30 : 0.36,
        metalness: isBelt ? 0.18 : 0.04,
        transparent: name === 'umb_clear',
        opacity: name === 'umb_clear' ? 0.74 : 1.0,
        side: isUmbrella ? THREE.DoubleSide : THREE.FrontSide,
      });
      m.clearcoat = isUmbrella ? 0.58 : prefix === 'rain' ? 0.65 : 0.48;
      m.clearcoatRoughness = 0.14;
    } else {
      m = new THREE.MeshStandardNodeMaterial({
        roughness: isCloth ? 0.64 : isTrim ? 0.28 : (mm.roughness ?? 0.62),
        metalness: isTrim ? 0.78 : isBelt ? 0.25 : isCloth ? 0.04 : (mm.metalness ?? 0),
      });
    }

    m.name = 'crowd_' + name;
    const fab = FABRIC[prefix];
    let detail = null, detailRep = 10;
    if (fab) {
      detail = this.fabric(fab[0] + '_d.jpg', true, fab[1]);
      detailRep = fab[1];
      if (!nmap) {
        const nrm = this.fabric(fab[0] + '_n.jpg', false, fab[1]);
        if (nrm) {
          m.normalMap = nrm;
          m.normalScale = new THREE.Vector2(fab[2], fab[2]);
        }
      }
    }
    if (map) m.map = map;
    if (nmap) {
      m.normalMap = nmap;
      m.normalScale = new THREE.Vector2(0.95, 0.95);
    }
    if (kind === 'hair' || name === 'brow' || name === 'lash') {
      m.alphaTest = 0.45;
      m.side = THREE.DoubleSide;
      m.roughness = 0.38;
    }
    if (name === 'skin') m.roughness = 0.44;
    if (name === 'eyes') m.roughness = 0.06;

    // Subtle realistic smartphone screen illumination
    if (name === 'phone_screen') {
      m.emissiveNode = vec3(0.72, 0.86, 1.0).mul(1.5);
    }

    const u = uv();
    let colorBase = map ? texture(map).rgb.mul(tintU) : tintU;

    // Micro-fabric weave detail for both textured and untextured garments
    if (detail && (isGarment || isFootwear)) {
      const fabSample = texture(detail, u.mul(detailRep)).r;
      const weaveAmt = map ? 0.28 : 0.85;
      colorBase = colorBase.mul(mix(float(1.0), fabSample.mul(1.82), float(weaveAmt)));
    }

    // Procedural multi-material pattern & sheen enrichment for garments
    if (isGarment) {
      const patMode = styleU.x;
      const patStr = styleU.y;
      const sheenStr = styleU.z;

      // Pattern 1: Woven plaid / Scottish tartan check (格纹/千鸟格肌理)
      const gx = sin(u.x.mul(96.0)), gy = sin(u.y.mul(96.0));
      const fineCheck = step(0.15, gx).mul(0.5).add(step(0.15, gy).mul(0.5));
      const overLine = smoothstep(0.92, 0.98, abs(sin(u.x.mul(32.0)))).max(smoothstep(0.92, 0.98, abs(sin(u.y.mul(32.0)))));
      const plaidMask = clamp(fineCheck.mul(0.65).add(overLine.mul(0.55)), 0, 1);

      // Pattern 2: Corduroy / vertical rib pinstripe (灯芯绒/竖条纹肌理)
      const cordWave = sin(u.x.mul(220.0)).mul(0.5).add(0.5);
      const cordMask = smoothstep(0.25, 0.75, cordWave);

      // Pattern 3: Breton horizontal knit stripe (针织横条纹/海魂条纹)
      const stripeWave = sin(u.y.mul(110.0));
      const stripeMask = smoothstep(-0.1, 0.1, stripeWave);

      // Pattern 4: Jiangnan brocade / Song-style jacquard cloud lattice (宋锦暗纹提花光泽)
      const jx = sin(u.x.mul(140.0).add(sin(u.y.mul(70.0)).mul(1.6)));
      const jy = cos(u.y.mul(140.0).sub(sin(u.x.mul(70.0)).mul(1.6)));
      const jacquardMask = smoothstep(0.2, 0.85, jx.mul(jy).mul(0.5).add(0.5));

      const isP1 = step(0.5, patMode).mul(step(patMode, 1.5));
      const isP2 = step(1.5, patMode).mul(step(patMode, 2.5));
      const isP3 = step(2.5, patMode).mul(step(patMode, 3.5));
      const isP4 = step(3.5, patMode);

      const patMask = plaidMask.mul(isP1)
        .add(cordMask.mul(isP2))
        .add(stripeMask.mul(isP3))
        .add(jacquardMask.mul(isP4));

      // Blend primary garment color with secondary accent yarn color along the woven pattern
      const yarnCol = mix(colorBase, colorBase.mul(tint2U).mul(1.18), clamp(patMask.mul(patStr.mul(2.4)), 0, 0.65));
      // Subtle seam / fold shading & corduroy micro-shadow
      const ribShade = mix(float(1.0), float(0.84).add(cordMask.mul(0.26)), isP2.mul(0.65));
      colorBase = yarnCol.mul(ribShade);

      // Physical grazing-angle velvet/silk/wool Fresnel sheen (织物边缘丝绒/羊绒光泽)
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const ndv = clamp( abs(dot(normalWorld, viewDir)), 0.0, 1.0 );
      const fresnel = float(1.0).sub(ndv).pow(2.6);
      const sheenBoost = float(1.0).add(jacquardMask.mul(isP4).mul(0.85));
      const sheenCol = mix(colorBase, tint2U.add(vec3(0.18, 0.16, 0.14)), 0.5);
      colorBase = colorBase.add(sheenCol.mul(fresnel).mul(sheenStr).mul(sheenBoost));
    }

    // Anisotropic hair sheen highlight so hair looks silky and layered under night-market lanterns
    if (kind === 'hair') {
      const viewDir = normalize(cameraPosition.sub(positionWorld));
      const ndv = clamp(abs(dot(normalWorld, viewDir)), 0.0, 1.0);
      const hairRim = float(1.0).sub(ndv).pow(2.2);
      const band = smoothstep(0.65, 0.95, sin(positionWorld.y.mul(42.0)));
      colorBase = colorBase.add(tintU.mul(1.8).add(vec3(0.06, 0.045, 0.035)).mul(hairRim.mul(0.45).add(band.mul(0.18))));
    }

    const alpha =
      name === 'umb_clear'
        ? float(0.74)
        : map && !isCloth && !isUmbrella
        ? texture(map).a
        : float(1);

    if (name !== 'phone_screen' && name !== 'eyes') {
      const baseRough = m.roughness;
      const porosity = name === 'skin' ? 0.08 : isCoated ? 0.04 : kind === 'hair' ? 0.26 : prefix === 'knit' ? 0.24 : 0.16;
      const up = clamp(normalWorld.y.mul(0.6).add(0.55), 0, 1);
      const wetAmt = W.mul(up);
      m.colorNode = vec4(colorBase.mul(mix(float(1), float(1 - porosity * 0.38), wetAmt)), alpha);
      const adjRough = clamp(float(baseRough).add(styleU.w), 0.12, 0.92);
      const wetRough = isCoated ? 0.10 : name === 'skin' ? 0.32 : isTrim ? 0.18 : 0.36;
      m.roughnessNode = mix(adjRough, float(Math.min(baseRough, wetRough)), wetAmt);
    } else {
      m.colorNode = vec4(colorBase, alpha);
    }

    this.matCache.set(name, m);
    return m;
  }

  fabric(file, srgb, repeat) {
    const path = 'textures/crowd/' + file;
    const k = path + '|' + repeat;
    if (this.textures.has(k)) return this.textures.get(k);
    const t = this.fabricTex?.[k] ?? null;
    return t;
  }

  async loadFabrics() {
    this.fabricTex = {};
    const jobs = [];
    for (const [f, rep] of Object.values(FABRIC).map((x) => [x[0], x[1]])) {
      for (const suf of ['_d.jpg', '_n.jpg']) {
        const path = 'textures/crowd/' + f + suf;
        const k = path + '|' + rep;
        if (k in this.fabricTex) continue;
        this.fabricTex[k] = null;
        jobs.push(
          this.ctx.assets.texture(path, { srgb: suf === '_d.jpg', repeat: [rep, rep] }).then((t) => {
            if (t) {
              t.flipY = false;
              t.needsUpdate = true;
            }
            this.fabricTex[k] = t;
          })
        );
      }
    }
    await Promise.all(jobs);
  }

  buildTemplates(entry) {
    const root = entry.gltf.scene;
    root.updateMatrixWorld(true);
    const byName = {};
    root.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) byName[o.name] = o;
      if (o.isGroup && o.children.some((c) => c.isMesh)) byName[o.name] = o;
    });
    entry.byName = byName;

    try {
      applyHanfuToEntry(entry);
    } catch (e) {
      console.warn('[crowd] applyHanfuToEntry warning:', e);
    }

    for (const outfit of entry.outfits) {
      entry.templates[outfit] = this.makeTemplate(entry, ['outfit_' + outfit, ...ACCESSORIES]);
      entry.lodTemplates[outfit] = byName['outfit_' + outfit + '_lod1'];
    }
  }

  makeTemplate(entry, keep) {
    const c = SkeletonUtils.clone(entry.gltf.scene);
    const remove = [];
    c.traverse((o) => {
      if ((o.isMesh || o.isSkinnedMesh) && o.parent) {
        const top =
          (o.parent.isGroup && o.parent.name.startsWith('outfit_')) ||
          o.parent.name.startsWith('umbrella_') ||
          o.parent.name === 'phone'
            ? o.parent
            : o;
        const nm = top.name;
        if (!keep.includes(nm)) remove.push(o);
      }
    });
    for (const o of remove) o.parent.remove(o);
    return c;
  }

  // ------------------------------------------------------------------------------------------ public
  createCharacter(variant = {}) {
    if (typeof variant === 'string') {
      const [sex, outfit] = variant.split(':');
      variant = { sex, outfit };
    }
    const sexes = Object.keys(this.sexes);
    if (!sexes.length) return null;
    const seed = variant.seed ?? 1;
    const sex = this.sexes[variant.sex] ? variant.sex : sexes[seed % sexes.length];
    const entry = this.sexes[sex];
    const outfit = entry.templates[variant.outfit] ? variant.outfit : entry.outfits[seed % entry.outfits.length];
    const obj = SkeletonUtils.clone(entry.templates[outfit]);
    obj.name = `crowd_${sex}_${outfit}`;
    const tint = variant.tint ?? (seed >>> 3);
    const hairTint = variant.hairTint ?? (seed >>> 7);
    const acc = {};
    const bones = {};
    obj.traverse((o) => {
      if (o.isBone) bones[o.name] = o;
      if (o.isMesh) {
        o.frustumCulled = false;
        o.castShadow = true;
        o.receiveShadow = true;
        const nm = (o.material?.name || '').replace(/^crowd_/, '');
        const isHair = nm.startsWith('hair');
        o.material = this.material(nm, entry.meta);
        o.userData.matName = nm;
        o.userData.tint = this.tintFor(nm, entry.meta, isHair ? hairTint : tint);
        o.userData.tint2 = this.accentFor(nm, tint + (seed >>> 5));
        o.userData.styleVec = this.styleFor(nm, seed + tint * 13);
        const top =
          o.parent && (o.parent.name.startsWith('umbrella_') || o.parent.name === 'phone') ? o.parent : o;
        if (ACCESSORIES.includes(top.name)) {
          (acc[top.name] ||= []).push(o);
          o.visible = false;
        }
      }
    });
    const mixer = new THREE.AnimationMixer(obj);
    const actions = {};
    for (const [n, clip] of Object.entries(entry.clips)) {
      const a = mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      a.play();
      actions[n] = a;
    }
    const sole = entry.meta.outfits[outfit]?.sole ?? 0;
    const lib = this;
    const ch = {
      object: obj,
      bones,
      mixer,
      actions,
      sex,
      outfit,
      sole,
      meta: entry.meta,
      setTint(t, h) {
        obj.traverse((o) => {
          if (o.isMesh && o.userData.matName) {
            const mName = o.userData.matName;
            o.userData.tint = lib.tintFor(
              mName,
              entry.meta,
              mName.startsWith('hair') ? h : t
            );
            o.userData.tint2 = lib.accentFor(mName, t + h * 7);
            o.userData.styleVec = lib.styleFor(mName, t * 17 + h * 31);
          }
        });
      },
      current: null,
      clipInfo: entry.meta.clips,
      setAccessory(umbrella, phone) {
        for (const k of ACCESSORIES) for (const m of acc[k] || []) m.visible = false;
        if (umbrella) for (const m of acc['umbrella_' + umbrella] || []) m.visible = true;
        if (phone) for (const m of acc.phone || []) m.visible = true;
      },
      play(name, fade = 0) {
        const a = actions[name];
        if (!a) return;
        if (ch.current === a && a.enabled && a.getEffectiveWeight() > 0.99) return;
        const prevTimeRatio = ch.current ? (ch.current.time / Math.max(1e-4, ch.current.getClip().duration)) : 0;
        for (const x of Object.values(actions)) {
          if (x === a) {
            x.enabled = true;
            x.setEffectiveTimeScale(1);
            x.setEffectiveWeight(1);
            x.play();
          } else {
            x.enabled = false;
            x.setEffectiveWeight(0);
          }
        }
        a.time = prevTimeRatio * a.getClip().duration;
        ch.current = a;
      },
      update(dt) {
        mixer.update(dt);
      },
    };
    ch.setAccessory(variant.umbrella, variant.phone);
    if (variant.clip) ch.play(variant.clip, 0);
    return ch;
  }
}

export { hashStr, ACCESSORIES };
