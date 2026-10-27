// Buildings system: procedural district plan, architectural volumes, ground-floor shopfronts,
// backstreet alley stairs/clutter, rooftop overlook deck, power/telecom cables, and instanced props.
// All shopfront, interior, shelf, vending, shutter, noren, and poster textures are 100% Chinese (Hangzhou Wulin Night Market).
import * as THREE from 'three/webgpu';
import { uniform } from 'three/tsl';
import { buildPlan } from './plan.js';
import { ChunkedBuckets } from './geom.js';
import { buildLotArchitecture, sideFrame } from './architecture.js';
import { ShopBuilder, ATLAS_SIZE, SLOTS, ATLAS_SOURCES } from './shops.js';
import { buildAlley } from './alley.js';
import { buildOverlook } from './overlook.js';
import { buildCables } from './cables.js';
import { buildProps } from './props.js';
import {
  createNoiseTexture,
  createFacadeMaterial,
  createDetailMaterial,
  createGlassMaterial,
} from './materials.js';

const UP = new THREE.Vector3(0, 1, 0);
const SERIF_CN = '"Kaiti SC", "STKaiti", "Songti SC", "Noto Serif SC", serif';
const SANS_CN = '"PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';

function drawVerticalText(g, text, x, yTop, yBot, font, color) {
  const chars = [...text];
  if (!chars.length) return;
  g.save();
  g.font = font;
  g.fillStyle = color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const span = yBot - yTop;
  const step = span / Math.max(1, chars.length);
  for (let i = 0; i < chars.length; i++) {
    g.fillText(chars[i], x, yTop + step * (i + 0.5));
  }
  g.restore();
}

async function buildWallAtlases(ctx) {
  const cellW = 512, cellH = 512;
  const W = cellW * 4, H = cellH * 2;
  const albCanvas = document.createElement('canvas');
  albCanvas.width = W; albCanvas.height = H;
  const albCtx = albCanvas.getContext('2d');

  const nrmCanvas = document.createElement('canvas');
  nrmCanvas.width = W; nrmCanvas.height = H;
  const nrmCtx = nrmCanvas.getContext('2d');

  nrmCtx.fillStyle = 'rgb(128,128,255)';
  nrmCtx.fillRect(0, 0, W, H);

  const sources = [
    { base: 'textures/ground/sidewalk_tiles', tint: '#5d656c' },
    { base: 'textures/landmarks/concrete', tint: '#7a7c7e' },
    { base: 'textures/landmarks/wood_slats', tint: '#585e64' },
    { base: 'textures/ground/concrete', tint: '#84807a' },
    { base: 'textures/ground/granite', tint: '#485058' },
    { base: 'textures/ground/alley_pavers', tint: '#6e473b' },
    { base: 'textures/ground/sidewalk_tiles', tint: '#b5b8bc' },
    { base: 'textures/ground/asphalt_a', tint: '#46484a' },
  ];

  await Promise.all(sources.map(async (s, layer) => {
    const col = layer % 4;
    const row = Math.floor(layer / 4);
    const x = col * cellW;
    const y = row * cellH;

    albCtx.fillStyle = s.tint;
    albCtx.fillRect(x, y, cellW, cellH);

    const [cTex, nTex] = await Promise.all([
      ctx.assets.texture(`${s.base}_c.png`, { srgb: true }).catch(() => null)
        .then((t) => t || ctx.assets.texture(`${s.base}.png`, { srgb: true }).catch(() => null)),
      ctx.assets.texture(`${s.base}_n.png`, { srgb: false }).catch(() => null),
    ]);

    if (cTex?.image) {
      albCtx.save();
      albCtx.globalAlpha = 0.75;
      albCtx.drawImage(cTex.image, x, y, cellW, cellH);
      albCtx.restore();
    }
    if (nTex?.image) {
      nrmCtx.drawImage(nTex.image, x, y, cellW, cellH);
    }
  }));

  const albedo = new THREE.CanvasTexture(albCanvas);
  albedo.colorSpace = THREE.SRGBColorSpace;
  albedo.wrapS = albedo.wrapT = THREE.ClampToEdgeWrapping;
  albedo.generateMipmaps = true;
  albedo.minFilter = THREE.LinearMipmapLinearFilter;
  albedo.needsUpdate = true;

  const normal = new THREE.CanvasTexture(nrmCanvas);
  normal.colorSpace = THREE.NoColorSpace;
  normal.wrapS = normal.wrapT = THREE.ClampToEdgeWrapping;
  normal.generateMipmaps = true;
  normal.minFilter = THREE.LinearMipmapLinearFilter;
  normal.needsUpdate = true;

  return { albedo, normal };
}

// Localize the 4x4 window interior atlas (`interior_atlas.png`) so zero Japanese text appears inside any building window
async function buildInteriorAtlas(ctx) {
  const baseTex = await ctx.assets.texture('textures/buildings/interior_atlas.png', { srgb: true, flipY: true }).catch(() => null);
  const S = 2048, C = 512;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const g = canvas.getContext('2d');
  if (baseTex?.image) {
    g.drawImage(baseTex.image, 0, 0, S, S);
  } else {
    g.fillStyle = '#3a2e24';
    g.fillRect(0, 0, S, S);
  }

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Cell (col=2, row=0): Bedroom wall poster (`また、どこかで` -> `西湖夜色 · 钱塘`)
  {
    const cx = 2 * C, cy = 0 * C;
    g.fillStyle = '#142038';
    g.fillRect(cx + 70, cy + 12, 174, 58);
    g.fillStyle = '#f4dfb0';
    g.font = `700 22px ${SERIF_CN}`;
    g.fillText('西湖夜色 · 钱塘', cx + 157, cy + 40);
  }

  // Cell (col=3, row=0): Office whiteboard (`やること ...` -> Chinese studio task board)
  {
    const cx = 3 * C, cy = 0 * C;
    g.fillStyle = '#e8e4dc';
    g.fillRect(cx + 42, cy + 62, 296, 240);
    g.fillStyle = '#242220';
    g.textAlign = 'left';
    g.font = `700 20px ${SANS_CN}`;
    g.fillText('杭州文创设计室 · 今日待办', cx + 56, cy + 92);
    g.font = `600 16px ${SANS_CN}`;
    const tasks = [
      '☑ 武林夜市非遗展陈方案',
      '☑ 西湖绸伞纹样打样确认',
      '□ 明前龙井茶礼包装定稿',
      '□ 河坊街商户导览图校对',
      '□ 江南宋韵文化画册排版',
    ];
    tasks.forEach((t, i) => g.fillText(t, cx + 56, cy + 130 + i * 30));
    g.textAlign = 'center';
    g.fillStyle = '#8c221c';
    g.font = `900 22px ${SERIF_CN}`;
    g.fillText('匠心筑梦', cx + 286, cy + 145);
    g.fillText('天道酬勤', cx + 286, cy + 180);
  }

  // Cell (col=1, row=1): Storage closet cardboard boxes (`無印良品`, `書類`, `衣類`, `生活用品`)
  {
    const cx = 1 * C, cy = 1 * C;
    // Box 1: left tall box
    g.fillStyle = '#9c7a54';
    g.fillRect(cx + 22, cy + 56, 118, 128);
    g.fillStyle = '#382414';
    g.font = `800 22px ${SANS_CN}`;
    g.fillText('杭州织造', cx + 81, cy + 114);
    // Box 2: middle small box
    g.fillStyle = '#b49672';
    g.fillRect(cx + 160, cy + 96, 72, 92);
    g.fillStyle = '#2c1e12';
    g.font = `700 18px ${SERIF_CN}`;
    g.fillText('文书卷宗', cx + 196, cy + 142);
    // Box 3: middle-right box
    g.fillStyle = '#9e7c56';
    g.fillRect(cx + 244, cy + 216, 142, 82);
    g.fillStyle = '#2c1e12';
    g.font = `700 22px ${SERIF_CN}`;
    g.fillText('四季锦衣', cx + 315, cy + 256);
    // Box 4: bottom-right box
    g.fillStyle = '#96744e';
    g.fillRect(cx + 244, cy + 314, 152, 162);
    g.fillStyle = '#2c1e12';
    g.font = `700 24px ${SERIF_CN}`;
    g.fillText('江南茶器 · 日用', cx + 320, cy + 392);
  }

  // Cell (col=2, row=1): Wall calendar & sticky note (`今日もいい日になる` -> `平安喜乐`)
  {
    const cx = 2 * C, cy = 1 * C;
    g.fillStyle = '#e6dfd2';
    g.fillRect(cx + 114, cy + 266, 124, 112);
    g.fillStyle = '#2c2620';
    g.font = `700 20px ${SERIF_CN}`;
    g.fillText('今日顺遂', cx + 176, cy + 306);
    g.fillText('平安喜乐', cx + 176, cy + 340);
    // Calendar header
    g.fillStyle = '#ece8e0';
    g.fillRect(cx + 272, cy + 172, 180, 32);
    g.fillStyle = '#22201e';
    g.font = `800 18px ${SANS_CN}`;
    g.fillText('四月 · 江南春晓', cx + 362, cy + 188);
  }

  // Cell (col=3, row=1): 3 Wall posters (`君の名は。`, `SPY×FAMILY`, `Re:ゼロ` -> Chinese cultural & film posters)
  {
    const cx = 3 * C, cy = 1 * C;
    // Left poster
    const g1 = g.createLinearGradient(cx + 24, cy + 14, cx + 24, cy + 346);
    g1.addColorStop(0, '#122642'); g1.addColorStop(0.6, '#264868'); g1.addColorStop(1, '#1a1c28');
    g.fillStyle = g1; g.fillRect(cx + 24, cy + 14, 220, 332);
    g.strokeStyle = '#dfbe7f'; g.lineWidth = 3; g.strokeRect(cx + 30, cy + 20, 208, 320);
    g.fillStyle = '#f8e8c0'; g.font = `900 32px ${SERIF_CN}`;
    g.fillText('西湖传说', cx + 134, cy + 84);
    g.fillStyle = '#9ad8e8'; g.font = `700 18px ${SANS_CN}`;
    g.fillText('断桥烟雨 · 千年寻梦', cx + 134, cy + 130);
    // Moon & pagoda silhouette
    g.fillStyle = 'rgba(248, 228, 176, 0.85)';
    g.beginPath(); g.arc(cx + 134, cy + 225, 42, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#101824';
    g.fillRect(cx + 126, cy + 195, 16, 75);
    g.fillRect(cx + 40, cy + 270, 188, 66);

    // Top-right poster
    const g2 = g.createLinearGradient(cx + 270, cy + 14, cx + 270, cy + 210);
    g2.addColorStop(0, '#2a382c'); g2.addColorStop(1, '#162018');
    g.fillStyle = g2; g.fillRect(cx + 270, cy + 14, 222, 196);
    g.strokeStyle = '#a8d5cb'; g.lineWidth = 3; g.strokeRect(cx + 276, cy + 20, 210, 184);
    g.fillStyle = '#f4ebd0'; g.font = `900 30px ${SERIF_CN}`;
    g.fillText('钱塘风云录', cx + 381, cy + 92);
    g.fillStyle = '#a8d5cb'; g.font = `700 18px ${SANS_CN}`;
    g.fillText('武林门下 · 侠影江湖', cx + 381, cy + 144);

    // Bottom-right poster
    const g3 = g.createLinearGradient(cx + 270, cy + 224, cx + 270, cy + 392);
    g3.addColorStop(0, '#3a1c28'); g3.addColorStop(1, '#1c1018');
    g.fillStyle = g3; g.fillRect(cx + 270, cy + 224, 222, 168);
    g.strokeStyle = '#f0b8c8'; g.lineWidth = 3; g.strokeRect(cx + 276, cy + 230, 210, 156);
    g.fillStyle = '#ffeef4'; g.font = `900 28px ${SERIF_CN}`;
    g.fillText('江南越剧雅集', cx + 381, cy + 292);
    g.fillStyle = '#f0b8c8'; g.font = `700 17px ${SANS_CN}`;
    g.fillText('梁祝化蝶 · 经典传唱', cx + 381, cy + 338);
  }

  // Cell (col=1, row=2): Shoji screen room hanging scroll (`一期一会` -> `清风明月`)
  {
    const cx = 1 * C, cy = 2 * C;
    g.fillStyle = '#cbb894';
    g.fillRect(cx + 416, cy + 92, 66, 198);
    g.strokeStyle = '#5c462c'; g.lineWidth = 2;
    g.strokeRect(cx + 420, cy + 96, 58, 190);
    drawVerticalText(g, '清风明月', cx + 449, cy + 108, cy + 272, `900 30px ${SERIF_CN}`, '#1e1812');
  }

  // Cell (col=3, row=2): Hallway framed calligraphy (`無事` -> `平安`)
  {
    const cx = 3 * C, cy = 2 * C;
    g.fillStyle = '#d8ceb8';
    g.fillRect(cx + 428, cy + 64, 56, 102);
    drawVerticalText(g, '平安', cx + 456, cy + 72, cy + 156, `900 32px ${SERIF_CN}`, '#1a1612');
  }

  // Cell (col=0, row=3): Study desk black poster (`好きなことで生きていく` -> `心怀热爱 · 奔赴山海`)
  {
    const cx = 0 * C, cy = 3 * C;
    g.fillStyle = '#18181a';
    g.fillRect(cx + 76, cy + 32, 106, 146);
    g.strokeStyle = '#dfbe7f'; g.lineWidth = 2;
    g.strokeRect(cx + 80, cy + 36, 98, 138);
    g.fillStyle = '#f4dfb0';
    g.font = `800 18px ${SERIF_CN}`;
    g.fillText('心怀热爱', cx + 129, cy + 88);
    g.fillText('奔赴山海', cx + 129, cy + 122);
  }

  // Cell (col=2, row=3): Gallery framed picture (Mt. Fuji -> West Lake ink-wash landscape `西湖烟雨图`)
  {
    const cx = 2 * C, cy = 3 * C;
    g.fillStyle = '#dfd8c8';
    g.fillRect(cx + 132, cy + 126, 246, 178);
    // Misty distant hills & West Lake water
    g.fillStyle = '#586468';
    g.beginPath();
    g.moveTo(cx + 148, cy + 235);
    g.quadraticCurveTo(cx + 205, cy + 178, cx + 260, cy + 215);
    g.quadraticCurveTo(cx + 315, cy + 168, cx + 364, cy + 235);
    g.closePath();
    g.fill();
    // Baoshu Pagoda spire on hill
    g.fillStyle = '#2c3438';
    g.fillRect(cx + 312, cy + 150, 6, 36);
    // Lake reflection & title
    g.fillStyle = '#8a9496';
    g.fillRect(cx + 148, cy + 235, 216, 48);
    g.fillStyle = '#2a2622';
    g.font = `700 16px ${SERIF_CN}`;
    g.fillText('西湖烟雨图', cx + 195, cy + 156);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

async function buildShopAtlas(ctx) {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_SIZE;
  canvas.height = ATLAS_SIZE;
  const g = canvas.getContext('2d');
  g.fillStyle = '#181412';
  g.fillRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);

  await Promise.all(Object.entries(SLOTS).map(async ([slot, [x, y, w, h]]) => {
    const srcName = ATLAS_SOURCES[slot];
    const path = slot === 'posters'
      ? 'textures/signage/posters_atlas.png'
      : `textures/buildings/${srcName}.png`;
    const tex = await ctx.assets.texture(path, { srgb: true }).catch(() => null);
    if (tex?.image) {
      g.drawImage(tex.image, x, y, w, h);
    }
  }));

  g.textAlign = 'center';
  g.textBaseline = 'middle';

  // Slots 1-8 (ramen, izakaya, konbini, pachinko, shelves, shutter, vending, noren) now use native 1K ArtForge Jiangnan textures directly.
  // ============================================================================
  // 9. SLOTS.posters ([0, 3072, 1024, 1024]): 杭州江南风物招贴画 (4x4 grid so all 16 cells have Chinese art)
  // ============================================================================
  {
    const [px, py, pw, ph] = SLOTS.posters;
    const cw = pw / 4, ch = ph / 4;
    const pList = [
      { t: '西湖夜游', s: '三潭印月 · 画舫笙歌', bg: '#102438', fg: '#f8e6b8', acc: '#38d8ff' },
      { t: '明前龙井', s: '狮峰头采 · 甘醇如玉', bg: '#163626', fg: '#f4ebd0', acc: '#88e868' },
      { t: '江南评弹', s: '琵琶三弦 · 听雨茶座', bg: '#321424', fg: '#ffe8f0', acc: '#ff60a8' },
      { t: '河坊夜市', s: '定胜糕 · 桂花糖藕', bg: '#78181c', fg: '#fff6d8', acc: '#ffd040' },
      { t: '越剧新声', s: '梁祝化蝶 · 经典戏台', bg: '#241842', fg: '#f0e8ff', acc: '#b070ff' },
      { t: '知味早茶', s: '鲜肉小笼 · 猫耳朵', bg: '#382214', fg: '#ffe8c0', acc: '#ff8830' },
      { t: '钱塘观潮', s: '六和听涛 · 气吞山河', bg: '#0e1e36', fg: '#ffffff', acc: '#00e8ff' },
      { t: '杭罗丝绸', s: '非遗云锦 · 江南织造', bg: '#1f1916', fg: '#ffd898', acc: '#ff5040' },
      { t: '奎元面馆', s: '老底子片儿川 · 虾爆鳝', bg: '#581818', fg: '#fff6e0', acc: '#f4c852' },
      { t: '西泠印学', s: '金石篆刻 · 湖山雅集', bg: '#282420', fg: '#f4ebd4', acc: '#d45b43' },
      { t: '拱宸夜色', s: '千年运河 · 桥西灯火', bg: '#142838', fg: '#e8f4ff', acc: '#68d8d8' },
      { t: '灵隐禅茶', s: '云林问茶 · 清心雅韵', bg: '#1c3224', fg: '#f0ebd8', acc: '#a8d888' },
      { t: '楼外楼宴', s: '西湖醋鱼 · 宋嫂鱼羹', bg: '#681c18', fg: '#fff8e8', acc: '#ffd058' },
      { t: '西湖绸伞', s: '竹骨绸面 · 江南非遗', bg: '#183842', fg: '#f0f8ff', acc: '#78e8d8' },
      { t: '南宋御街', s: '百工百戏 · 繁华市井', bg: '#381e14', fg: '#ffe8c8', acc: '#ff9848' },
      { t: '断桥残雪', s: '宝石流霞 · 西子晴雨', bg: '#182438', fg: '#f4f0e8', acc: '#98c8ff' },
    ];
    pList.forEach((p, idx) => {
      const col = idx % 4, row = Math.floor(idx / 4);
      const x0 = px + col * cw, y0 = py + row * ch;
      g.fillStyle = p.bg; g.fillRect(x0 + 4, y0 + 4, cw - 8, ch - 8);
      g.strokeStyle = p.acc; g.lineWidth = 4; g.strokeRect(x0 + 12, y0 + 12, cw - 24, ch - 24);
      g.fillStyle = p.acc; g.font = `800 18px ${SANS_CN}`;
      g.fillText('杭州 · 江南风物', x0 + cw / 2, y0 + 42);
      g.fillStyle = p.fg; g.font = `900 46px ${SERIF_CN}`;
      g.fillText(p.t, x0 + cw / 2, y0 + ch * 0.50);
      g.fillStyle = p.acc; g.font = `700 20px ${SANS_CN}`;
      g.fillText(p.s, x0 + cw / 2, y0 + ch * 0.80);
    });
  }

  const atlas = new THREE.CanvasTexture(canvas);
  atlas.colorSpace = THREE.SRGBColorSpace;
  atlas.wrapS = atlas.wrapT = THREE.ClampToEdgeWrapping;
  atlas.generateMipmaps = true;
  atlas.minFilter = THREE.LinearMipmapLinearFilter;
  atlas.needsUpdate = true;
  return atlas;
}

export default {
  async init(ctx) {
    const t0 = performance.now();
    const { scene } = ctx;
    const wetness = uniform(1.0);
    this.wetness = wetness;

    const { lots, heightCap } = buildPlan(ctx.layout);
    const B = new ChunkedBuckets(96);
    const out = { colliders: [], lights: [] };
    const shopBuilder = new ShopBuilder(B, out);
    const facades = [];
    const shops = [];

    for (const lot of lots) {
      buildLotArchitecture(lot, B, out);
      const v0 = lot.volumes?.[0];
      if (!v0) continue;
      for (const front of lot.fronts) {
        const fr = sideFrame(v0, front.side, 0);
        const baseY = front.baseY > 0 ? front.baseY : 0;
        if (front.shop && lot.detail === 'hi' && front.baseY >= 0 && fr.width >= 3.5) {
          front.shopType = shopBuilder.build(lot, front);
          shops.push({
            type: front.shopType,
            position: new THREE.Vector3(
              fr.origin[0] + fr.right[0] * (fr.width * 0.5),
              baseY + 1.5,
              fr.origin[2] + fr.right[2] * (fr.width * 0.5)
            ),
          });
        }
        const n = new THREE.Vector3(...fr.normal).normalize();
        const right = new THREE.Vector3(...fr.right).normalize();
        const h = lot.h - baseY;
        const center = new THREE.Vector3(
          fr.origin[0] + fr.right[0] * (fr.width * 0.5),
          baseY + h * 0.5,
          fr.origin[2] + fr.right[2] * (fr.width * 0.5)
        );
        facades.push({
          lotId: lot.id,
          center,
          normal: n,
          right,
          width: fr.width,
          height: h,
          floors: lot.floors,
          floorHeight: lot.floorH,
          groundH: lot.groundH,
          baseY,
          district: front.district,
          shopfront: !!front.shop && front.baseY >= 0,
          shopType: front.shopType || null,
          overlook: !!lot.overlook,
        });
      }
    }

    buildAlley(ctx, lots, B, out);
    buildOverlook(ctx, lots, B, out);
    buildCables(ctx, lots, B, out);

    const propMeshes = await buildProps(ctx, lots, B, out, { wetness });

    const noise = createNoiseTexture(512);
    const [{ albedo, normal }, shopAtlas, interiorTex] = await Promise.all([
      buildWallAtlases(ctx),
      buildShopAtlas(ctx),
      buildInteriorAtlas(ctx),
    ]);
    const fallbackTex = new THREE.DataTexture(new Uint8Array([180, 140, 100, 255]), 1, 1);
    fallbackTex.needsUpdate = true;

    const mats = {
      facade: createFacadeMaterial({ albedo, normal, interior: interiorTex || fallbackTex, wetness, noise }),
      detail: createDetailMaterial({ atlas: shopAtlas, wetness, noise }),
      glass: createGlassMaterial(),
    };

    const group = new THREE.Group();
    group.name = 'buildings';
    for (const bucket of B.map.values()) {
      const geo = bucket.build();
      if (!geo) continue;
      const mat = mats[bucket.matKey];
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = `bld_${bucket.matKey}_${bucket.chunk[0]}_${bucket.chunk[1]}`;
      mesh.castShadow = bucket.matKey === 'facade';
      mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    for (const im of propMeshes) group.add(im);
    scene.add(group);

    if (ctx.physics) {
      const { RAPIER, world } = ctx.physics;
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed());
      for (const c of out.colliders) {
        const d = RAPIER.ColliderDesc.cuboid(c.hx, c.hy, c.hz).setTranslation(c.x, c.y, c.z);
        if (c.rot) d.setRotation(c.rot);
        world.createCollider(d, body);
      }
    }

    ctx.api.buildings = {
      facades,
      lots,
      shops,
      heightCap,
      lights: out.lights,
    };
    console.log(`[buildings] ${lots.length} lots, ${facades.length} facades, ${shops.length} shops, ${B.map.size} mesh chunks, ${out.colliders.length} colliders in ${(performance.now() - t0).toFixed(0)}ms`);
  },

  update(dt, t, ctx) {
    if (this.wetness) {
      this.wetness.value = ctx.weather?.wetness ?? 1.0;
    }
  },
};
