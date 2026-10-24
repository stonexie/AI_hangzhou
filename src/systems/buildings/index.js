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

  // ============================================================================
  // 1. SLOTS.ramen ([0, 0, 2048, 1024]): 老杭州片儿川面馆 (Kuiyuan Noodle Kitchen)
  // ============================================================================
  {
    const [rx, ry, rw, rh] = SLOTS.ramen;
    // Top wooden beam & hanging wooden menu plaques (replaces all Japanese ramen wooden tags)
    const beamGrad = g.createLinearGradient(rx, ry, rx, ry + 308);
    beamGrad.addColorStop(0, '#2a1a0e');
    beamGrad.addColorStop(0.5, '#3b2414');
    beamGrad.addColorStop(1, '#26170c');
    g.fillStyle = beamGrad;
    g.fillRect(rx, ry, rw, 308);
    g.fillStyle = '#4e321c';
    g.fillRect(rx, ry + 292, rw, 18);

    // Left hero wooden signboard (`奎元面馆`)
    g.fillStyle = '#b6844c';
    g.fillRect(rx + 42, ry + 36, 152, 248);
    g.strokeStyle = '#4a2c14'; g.lineWidth = 4;
    g.strokeRect(rx + 48, ry + 42, 140, 236);
    drawVerticalText(g, '奎元面馆', rx + 118, ry + 54, ry + 244, `900 44px ${SERIF_CN}`, '#1a1008');
    g.fillStyle = '#b8221e';
    g.fillRect(rx + 146, ry + 236, 28, 28);
    g.fillStyle = '#fff8ea'; g.font = `700 18px ${SERIF_CN}`;
    g.fillText('杭', rx + 160, ry + 250);

    // 12 vertical cedar menu plaques with authentic Hangzhou noodle dishes & RMB prices
    const ramenMenus = [
      ['片儿川面', '22元'],
      ['虾爆鳝面', '38元'],
      ['东坡肉面', '32元'],
      ['雪菜笋片', '20元'],
      ['三鲜汤面', '26元'],
      ['猪肝拌川', '28元'],
      ['牛肉拌川', '30元'],
      ['葱油拌面', '15元'],
      ['知味小笼', '18元'],
      ['脆皮大肠', '25元'],
      ['桂花糖藕', '16元'],
      ['西湖精酿', '18元'],
    ];
    ramenMenus.forEach(([dish, price], i) => {
      const px = rx + 260 + i * 126;
      const py = ry + 44;
      const pw = 104, ph = 236;
      const wg = g.createLinearGradient(px, py, px + pw, py);
      wg.addColorStop(0, '#c89658'); wg.addColorStop(0.5, '#d8a86c'); wg.addColorStop(1, '#b88448');
      g.fillStyle = wg;
      g.fillRect(px, py, pw, ph);
      g.strokeStyle = '#5c3818'; g.lineWidth = 3;
      g.strokeRect(px + 3, py + 3, pw - 6, ph - 6);
      // Hanging nail
      g.fillStyle = '#24160a';
      g.beginPath(); g.arc(px + pw / 2, py + 12, 4, 0, Math.PI * 2); g.fill();
      drawVerticalText(g, dish, px + pw / 2, py + 24, py + 194, `900 34px ${SERIF_CN}`, '#1a1008');
      g.fillStyle = '#8c1c16';
      g.font = `800 22px ${SANS_CN}`;
      g.fillText(price, px + pw / 2, py + 216);
    });

    // Right wooden plaque (`百年江南`)
    g.fillStyle = '#b6844c';
    g.fillRect(rx + 1840, ry + 36, 152, 248);
    g.strokeStyle = '#4a2c14'; g.lineWidth = 4;
    g.strokeRect(rx + 1846, ry + 42, 140, 236);
    drawVerticalText(g, '百年江南', rx + 1916, ry + 54, ry + 244, `900 44px ${SERIF_CN}`, '#1a1008');

    // Warm filament pendant bulbs along the top beam
    for (const bx of [rx + 230, rx + 945, rx + 1790]) {
      const rg = g.createRadialGradient(bx, ry + 68, 4, bx, ry + 68, 56);
      rg.addColorStop(0, '#fffdf0');
      rg.addColorStop(0.35, 'rgba(255, 210, 120, 0.85)');
      rg.addColorStop(1, 'rgba(255, 170, 60, 0)');
      g.fillStyle = rg;
      g.beginPath(); g.arc(bx, ry + 68, 56, 0, Math.PI * 2); g.fill();
    }

    // Replace daruma on left shelf (`x: 52..126, y: 350..428`) with a celadon Longjing tea jar (`龙井`)
    g.fillStyle = '#6e9a86';
    g.beginPath(); g.roundRect(rx + 56, ry + 356, 66, 70, 18); g.fill();
    g.fillStyle = '#f4ebd0';
    g.fillRect(rx + 70, ry + 372, 38, 38);
    g.fillStyle = '#183628'; g.font = `900 18px ${SERIF_CN}`;
    g.fillText('龙井', rx + 89, ry + 392);

    // Replace right kitchen noren (`麺` at `x: 1405..1812, y: 332..638`) with Chinese indigo cloth curtain
    g.fillStyle = '#162034';
    g.fillRect(rx + 1406, ry + 332, 196, 304);
    g.fillRect(rx + 1612, ry + 332, 198, 304);
    g.strokeStyle = '#dfbe7f'; g.lineWidth = 3;
    g.strokeRect(rx + 1416, ry + 342, 176, 284);
    g.strokeRect(rx + 1622, ry + 342, 178, 284);
    g.fillStyle = '#f5efe2'; g.font = `900 84px ${SERIF_CN}`;
    g.fillText('杭', rx + 1504, ry + 492);
    g.fillText('面', rx + 1711, ry + 492);
    g.fillStyle = '#b8221e';
    g.fillRect(rx + 1756, ry + 576, 28, 28);
    g.fillStyle = '#fff8ea'; g.font = `700 16px ${SERIF_CN}`;
    g.fillText('鲜', rx + 1770, ry + 590);

    // Replace right vertical scroll (`うまい一杯で...` at `x: 1838..1960, y: 325..685`)
    g.fillStyle = '#d8c8a8';
    g.fillRect(rx + 1838, ry + 326, 120, 358);
    g.strokeStyle = '#5c4228'; g.lineWidth = 3;
    g.strokeRect(rx + 1844, ry + 332, 108, 346);
    drawVerticalText(g, '一碗片儿川', rx + 1916, ry + 350, ry + 635, `900 30px ${SERIF_CN}`, '#22160c');
    drawVerticalText(g, '满城江南香', rx + 1876, ry + 350, ry + 635, `900 30px ${SERIF_CN}`, '#22160c');

    // Replace wooden noodle crate (`三河製麺` at `x: 1765..1960, y: 760..836`)
    g.fillStyle = '#9c6e3a';
    g.fillRect(rx + 1766, ry + 762, 192, 72);
    g.strokeStyle = '#4e3214'; g.lineWidth = 3;
    g.strokeRect(rx + 1770, ry + 766, 184, 64);
    g.fillStyle = '#1e1208'; g.font = `900 32px ${SERIF_CN}`;
    g.fillText('杭州制面坊', rx + 1862, ry + 798);
  }

  // ============================================================================
  // 2. SLOTS.izakaya ([0, 1024, 2048, 1024]): 太和酒肆 · 江南夜酒馆 (Jiangnan Tavern)
  // ============================================================================
  {
    const [ix, iy, iw, ih] = SLOTS.izakaya;
    // Top horizontal wooden plaque (`酒は人をつなぐ` -> `酒香飘武林 · 雅座慢饮`)
    const pGrad = g.createLinearGradient(ix + 685, iy + 6, ix + 1370, iy + 168);
    pGrad.addColorStop(0, '#5a3a1e'); pGrad.addColorStop(0.5, '#6e4826'); pGrad.addColorStop(1, '#4e3018');
    g.fillStyle = pGrad;
    g.fillRect(ix + 686, iy + 6, 682, 160);
    g.strokeStyle = '#2e1a0c'; g.lineWidth = 5;
    g.strokeRect(ix + 692, iy + 12, 670, 148);
    g.fillStyle = '#180e06';
    g.font = `900 74px ${SERIF_CN}`;
    g.fillText('酒香醉江南', ix + 1005, iy + 88);
    g.fillStyle = '#b8221e';
    g.fillRect(ix + 1272, iy + 62, 54, 54);
    g.fillStyle = '#fff8ea'; g.font = `800 26px ${SERIF_CN}`;
    g.fillText('太和', ix + 1299, iy + 89);

    // Left paper lantern (`居酒屋` -> `太和酒肆`)
    const lGrad = g.createRadialGradient(ix + 266, iy + 156, 20, ix + 266, iy + 156, 130);
    lGrad.addColorStop(0, '#fff6d8');
    lGrad.addColorStop(0.65, '#f4c878');
    lGrad.addColorStop(1, '#c88238');
    g.fillStyle = lGrad;
    g.beginPath(); g.ellipse(ix + 266, iy + 156, 102, 124, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#5c2c10'; g.lineWidth = 3;
    for (let r = -90; r <= 90; r += 30) {
      g.beginPath(); g.ellipse(ix + 266, iy + 156 + r, Math.sqrt(Math.max(0, 1 - (r / 124) ** 2)) * 100, 10, 0, 0, Math.PI * 2); g.stroke();
    }
    drawVerticalText(g, '太和酒肆', ix + 266, iy + 48, iy + 264, `900 54px ${SERIF_CN}`, '#1a0e06');

    // Top-right vertical wooden plaque (`一期一会` -> `把酒言欢`)
    g.fillStyle = '#28180e';
    g.fillRect(ix + 1672, iy + 14, 126, 212);
    g.strokeStyle = '#6a4828'; g.lineWidth = 3;
    g.strokeRect(ix + 1678, iy + 20, 114, 200);
    drawVerticalText(g, '把酒言欢', ix + 1735, iy + 32, iy + 208, `900 42px ${SERIF_CN}`, '#d8b478');

    // Far-right scroll (`旨い酒と良い肴` -> `佳酿配良肴 · 江南不夜天`)
    g.fillStyle = '#d4b88c';
    g.fillRect(ix + 1902, iy + 176, 132, 246);
    g.strokeStyle = '#5c3c1e'; g.lineWidth = 3;
    g.strokeRect(ix + 1908, iy + 182, 120, 234);
    drawVerticalText(g, '佳酿配良肴', ix + 1992, iy + 196, iy + 398, `900 32px ${SERIF_CN}`, '#22140a');
    drawVerticalText(g, '江南不夜天', ix + 1944, iy + 196, iy + 398, `900 32px ${SERIF_CN}`, '#22140a');

    // Bottom-right cloth banner (`飲みすぎ注意` -> `微醺江南 · 雅座慢饮`)
    g.fillStyle = '#c8b496';
    g.fillRect(ix + 1932, iy + 648, 112, 286);
    g.strokeStyle = '#4e3620'; g.lineWidth = 3;
    g.strokeRect(ix + 1938, iy + 654, 100, 274);
    drawVerticalText(g, '微醺江南夜', ix + 1988, iy + 672, iy + 908, `900 34px ${SERIF_CN}`, '#1e120a');

    // Left menu chalkboard (`本日のおすすめ` -> `今日杭帮时令名菜`)
    g.fillStyle = '#1c1816';
    g.fillRect(ix + 18, iy + 362, 304, 322);
    g.strokeStyle = '#5e3c20'; g.lineWidth = 8;
    g.strokeRect(ix + 14, iy + 358, 312, 330);
    g.fillStyle = '#f2e6cf';
    g.font = `900 28px ${SERIF_CN}`;
    g.fillText('今日杭帮时令名菜', ix + 170, iy + 402);
    g.strokeStyle = 'rgba(242,230,207,0.5)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(ix + 46, iy + 422); g.lineTo(ix + 294, iy + 422); g.stroke();
    const boardItems = [
      ['· 西湖醋鱼', '68元'],
      ['· 龙井虾仁', '78元'],
      ['· 东坡焖肉', '58元'],
      ['· 干炸响铃', '36元'],
      ['· 桂花糯米藕', '28元'],
    ];
    boardItems.forEach(([name, pr], idx) => {
      const by = iy + 458 + idx * 46;
      g.textAlign = 'left';
      g.fillStyle = '#f2e6cf'; g.font = `700 23px ${SERIF_CN}`;
      g.fillText(name, ix + 34, by);
      g.textAlign = 'right';
      g.fillStyle = '#dfbe7f'; g.font = `700 22px ${SANS_CN}`;
      g.fillText(pr, ix + 304, by);
    });
    g.textAlign = 'center';

    // 16 hanging paper menu strips across `x: 396..1712, y: 196..392`
    g.fillStyle = '#28180e';
    g.fillRect(ix + 390, iy + 192, 1330, 204);
    const tavernMenus = [
      ['绍兴女儿红', '48元'],
      ['古越花雕酒', '58元'],
      ['西湖桂花酿', '38元'],
      ['江南青梅酒', '35元'],
      ['叫花童子鸡', '68元'],
      ['宋嫂鱼羹', '48元'],
      ['葱包桧儿', '18元'],
      ['卤味鸭舌', '42元'],
      ['糟香毛豆', '22元'],
      ['脆皮臭豆腐', '20元'],
      ['盐水河虾', '52元'],
      ['香干马兰头', '26元'],
      ['老底子八宝菜', '24元'],
      ['天目手剥笋', '32元'],
      ['桂花定胜糕', '16元'],
      ['酒酿小圆子', '20元'],
    ];
    tavernMenus.forEach(([dish, pr], i) => {
      const sx = ix + 398 + i * 82.5;
      const sy = iy + 198;
      const sw = 70, sh = 190;
      g.fillStyle = '#d8be98';
      g.fillRect(sx, sy, sw, sh);
      g.strokeStyle = '#6c4c2c'; g.lineWidth = 2;
      g.strokeRect(sx + 2, sy + 2, sw - 4, sh - 4);
      drawVerticalText(g, dish, sx + sw / 2, sy + 12, sy + 154, `900 23px ${SERIF_CN}`, '#1a1008');
      g.fillStyle = '#8c1c16'; g.font = `800 17px ${SANS_CN}`;
      g.fillText(pr, sx + sw / 2, sy + 174);
    });

    // Replace all 15 Japanese sake bottle labels across the bottle shelf (`x: 455..1700, y: 560..672`)
    const wineLabels = [
      { t: '女儿红', bg: '#f4ecd8', fg: '#8c1818' },
      { t: '状元红', bg: '#e8dcc4', fg: '#1a1410' },
      { t: '古越龙山', bg: '#f0e6d0', fg: '#1e2c48' },
      { t: '会稽山', bg: '#f4eee0', fg: '#221810' },
      { t: '西湖桂花', bg: '#f6ebd2', fg: '#782018' },
      { t: '江南花雕', bg: '#eadcc2', fg: '#881c18' },
      { t: '黒坛太雕', bg: '#1e1814', fg: '#dfbe7f' },
      { t: '丹溪红曲', bg: '#221614', fg: '#e03828' },
      { t: '竹叶青酒', bg: '#dce8d8', fg: '#183824' },
      { t: '青梅煮酒', bg: '#e6c878', fg: '#24180c' },
      { t: '钱塘佳酿', bg: '#f2e8d4', fg: '#1c1610' },
      { t: '武林陈酿', bg: '#ebd8b8', fg: '#2c1810' },
      { t: '西子梅酒', bg: '#e4d2b4', fg: '#1e1610' },
      { t: '善酿黄酒', bg: '#c89850', fg: '#1e140c' },
      { t: '醇香米酒', bg: '#1c1816', fg: '#f0e2c8' },
    ];
    const bottleX = [460, 540, 610, 684, 756, 830, 902, 986, 1064, 1140, 1214, 1290, 1364, 1440, 1516, 1592];
    wineLabels.forEach((wl, i) => {
      const bx = ix + (bottleX[i] || (460 + i * 76));
      g.fillStyle = wl.bg;
      g.fillRect(bx, iy + 562, 54, 104);
      g.strokeStyle = wl.fg; g.lineWidth = 2;
      g.strokeRect(bx + 3, iy + 565, 48, 98);
      drawVerticalText(g, wl.t, bx + 27, iy + 572, iy + 656, `900 21px ${SERIF_CN}`, wl.fg);
    });
    // Replace Yamazaki boxes on right shelf (`x: 1730..1875, y: 536..682` and `y: 742..948`)
    g.fillStyle = '#d8c8a8';
    g.fillRect(ix + 1760, iy + 538, 60, 142);
    drawVerticalText(g, '陈年花雕', ix + 1790, iy + 550, iy + 668, `900 22px ${SERIF_CN}`, '#1e140c');
    g.fillStyle = '#c8b898';
    g.fillRect(ix + 1738, iy + 744, 118, 202);
    drawVerticalText(g, '绍兴国酿', ix + 1797, iy + 762, iy + 928, `900 28px ${SERIF_CN}`, '#1e140c');
  }

  // ============================================================================
  // 3. SLOTS.konbini ([2048, 0, 2048, 1024]): 西子便利 · 24小时杭州便利店
  // ============================================================================
  {
    const [kx, ky, kw, kh] = SLOTS.konbini;
    // Top promotional lightboxes (`y: 26..178`)
    const topPanels = [
      { x: 82, w: 436, bg0: '#163052', bg1: '#244a74', t1: '西子便利 · 温暖杭城每一夜', t2: '廿四小时亮灯 · 伴您漫步武林夜市' },
      { x: 542, w: 214, bg0: '#e8eff4', bg1: '#d4e2ec', t1: '鲜食 · 茗茶 · 伴手礼', t2: '西子便利 XIZI MART', light: true },
      { x: 1172, w: 262, bg0: '#e8eff4', bg1: '#d4e2ec', t1: '邻里守望 · 贴心相伴', t2: '杭州便民服务驿站', light: true },
      { x: 1642, w: 374, bg0: '#163052', bg1: '#244a74', t1: '夜游西湖 · 能量补给站', t2: '现磨咖啡 · 关东煮 · 现蒸知味包点' },
    ];
    topPanels.forEach((p) => {
      const gr = g.createLinearGradient(kx + p.x, ky + 26, kx + p.x, ky + 176);
      gr.addColorStop(0, p.bg0); gr.addColorStop(1, p.bg1);
      g.fillStyle = gr;
      g.fillRect(kx + p.x, ky + 26, p.w, 150);
      g.strokeStyle = p.light ? '#1a8c64' : '#64b8e8'; g.lineWidth = 3;
      g.strokeRect(kx + p.x + 4, ky + 30, p.w - 8, 142);
      g.fillStyle = p.light ? '#14324a' : '#ffffff';
      g.font = `800 24px ${SANS_CN}`;
      g.fillText(p.t1, kx + p.x + p.w / 2, ky + 82);
      g.fillStyle = p.light ? '#15885e' : '#9ad8ff';
      g.font = `700 18px ${SANS_CN}`;
      g.fillText(p.t2, kx + p.x + p.w / 2, ky + 132);
    });

    // Category header signs (`y: 186..244`)
    const cats = [
      { x: 0, w: 518, badge: '休闲茶点', sub: '杭州特产 · 龙井茶酥 · 休闲零嘴', col: '#1878c8' },
      { x: 526, w: 416, badge: '冰镇茗茶', sub: '西湖龙井冷泡茶 · 鲜果茶饮', col: '#169668' },
      { x: 948, w: 352, badge: '微醺佳酿', sub: '西湖精酿 · 绍兴黄酒 · 未成年人禁售', col: '#283848' },
      { x: 1304, w: 336, badge: '鲜食便当', sub: '现蒸小笼 · 饭团三明治 · 鲜蔬沙拉', col: '#1878c8' },
      { x: 1644, w: 404, badge: '人文图书', sub: '杭州漫游指南 · 江南文化画报', col: '#169668' },
    ];
    cats.forEach((c) => {
      g.fillStyle = '#f2f5f8';
      g.fillRect(kx + c.x, ky + 186, c.w, 56);
      g.fillStyle = c.col;
      g.fillRect(kx + c.x + 8, ky + 192, 118, 44);
      g.fillStyle = '#ffffff'; g.font = `800 20px ${SANS_CN}`;
      g.fillText(c.badge, kx + c.x + 67, ky + 214);
      g.fillStyle = '#1e2832'; g.font = `700 16px ${SANS_CN}`;
      g.fillText(c.sub, kx + c.x + 128 + (c.w - 134) / 2, ky + 214);
    });

    // Left snack shelves (`x: 0..518, y: 246..960`): Replace Japanese snack bags with Chinese snacks
    g.fillStyle = '#22262a';
    g.fillRect(kx + 4, ky + 246, 512, 718);
    const snackRows = [
      [['西湖藕粉', '#c82828'], ['龙井茶酥', '#288848'], ['桂花糕点', '#e08818'], ['定胜糕礼', '#b82238'], ['芝士脆片', '#2458a8']],
      [['薄荷柠檬糖', '#289878'], ['香脆锅巴', '#d85818'], ['海苔脆卷', '#1e6838'], ['牛乳曲奇', '#3868b8'], ['炭烧杏仁', '#784828']],
      [['山核桃仁', '#8c4c24'], ['青梅果干', '#2e7c44'], ['话梅糖果', '#b83248'], ['抹茶威化', '#388838'], ['黑松露酥', '#2c3038']],
      [['丝绸伴手礼', '#9c2228'], ['蜂蜜麻花', '#d88820'], ['脆皮山楂', '#c82828'], ['椰香脆片', '#2078b8'], ['牛乳软糖', '#e86888']],
      [['鲜虾脆片', '#d84828'], ['椒盐茶饼', '#387848'], ['桂花酥糖', '#d89820'], ['紫薯脆片', '#683888'], ['原味薯片', '#c82828']],
    ];
    snackRows.forEach((row, rIdx) => {
      const sy = ky + 254 + rIdx * 140;
      row.forEach(([label, col], cIdx) => {
        const sx = kx + 14 + cIdx * 99;
        g.fillStyle = col;
        g.beginPath(); g.roundRect(sx, sy, 90, 108, 8); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.65)'; g.lineWidth = 2;
        g.strokeRect(sx + 5, sy + 5, 80, 98);
        g.fillStyle = '#ffffff'; g.font = `900 18px ${SANS_CN}`;
        g.fillText(label, sx + 45, sy + 48);
        g.fillStyle = 'rgba(255,255,255,0.88)'; g.font = `700 13px ${SANS_CN}`;
        g.fillText('杭州特产', sx + 45, sy + 78);
      });
      // Shelf rail + RMB price tags
      g.fillStyle = '#d8dde2';
      g.fillRect(kx + 8, sy + 112, 504, 18);
      for (let cIdx = 0; cIdx < 5; cIdx++) {
        g.fillStyle = '#1a1e22'; g.font = `700 12px ${SANS_CN}`;
        g.fillText(`¥${12 + (rIdx + cIdx) % 8}.0`, kx + 59 + cIdx * 99, sy + 121);
      }
    });

    // Chiller section strip labels (`x: 1318..1628`)
    const chillerStrips = [
      { y: 428, h: 24, t: '现做饭团 · 三明治 · 鲜蔬沙拉' },
      { y: 554, h: 24, t: '每日鲜食 · 杭帮卤味 · 关东煮' },
      { y: 650, h: 24, t: '时令冷盘 · 桂花糖藕 · 鲜果切盒' },
      { y: 752, h: 36, t: '江南甜品 · 桂花酒酿酪 · 手作布丁' },
    ];
    chillerStrips.forEach((s) => {
      g.fillStyle = '#eef2f6';
      g.fillRect(kx + 1318, ky + s.y, 308, s.h);
      g.fillStyle = '#183048'; g.font = `800 15px ${SANS_CN}`;
      g.fillText(s.t, kx + 1472, ky + s.y + s.h / 2);
    });

    // Right magazine rack (`x: 1644..2044, y: 248..960`): Replace all 12 Japanese magazines with Chinese magazines
    g.fillStyle = '#cfd6dc';
    g.fillRect(kx + 1644, ky + 248, 400, 714);
    const mags = [
      ['杭州漫游', '西湖十景夜游全攻略', '#16324a', '#ffd875'],
      ['江南画报', '宋韵美学与现代建筑', '#8c1e22', '#fff6e0'],
      ['茶道生活', '明前龙井品鉴指南', '#18422c', '#e8f4d8'],
      ['钱塘美食', '寻味武林夜市老字号', '#382214', '#ffb848'],
      ['中国地理', '京杭大运河千年水脉', '#143848', '#7ce8f8'],
      ['丝绸时尚', '非遗杭罗与东方高定', '#421832', '#ffc8e8'],
      ['城市周刊', '数字杭州与智慧生活', '#1c2838', '#88d0ff'],
      ['人文江南', '西泠印社与文人书画', '#2c2620', '#f0dfc0'],
      ['周末生活', '湖滨步行街夜肆寻宝', '#78281c', '#ffe8b8'],
      ['西湖诗词', '历代钱塘诗词名篇选', '#1e3632', '#d8f0e8'],
      ['江南建筑', '白墙黛瓦里的江南院落', '#282c30', '#e8e4dc'],
      ['杭州指南', '武林商圈漫步舆图', '#183868', '#ffd858'],
    ];
    mags.forEach(([title, sub, bg, acc], idx) => {
      const col = idx % 3, row = Math.floor(idx / 3);
      const mx = kx + 1652 + col * 130;
      const my = ky + 256 + row * 176;
      const mw = 122, mh = 164;
      g.fillStyle = bg;
      g.fillRect(mx, my, mw, mh);
      g.strokeStyle = acc; g.lineWidth = 2;
      g.strokeRect(mx + 4, my + 4, mw - 8, mh - 8);
      g.fillStyle = acc; g.font = `900 24px ${SERIF_CN}`;
      g.fillText(title, mx + mw / 2, my + 46);
      g.fillStyle = '#ffffff'; g.font = `600 12px ${SANS_CN}`;
      g.fillText(sub.slice(0, 6), mx + mw / 2, my + 98);
      g.fillText(sub.slice(6), mx + mw / 2, my + 118);
      g.fillStyle = '#e0dce4';
      g.fillRect(mx, my + mh - 14, mw, 14);
      g.fillStyle = '#222'; g.font = `700 11px ${SANS_CN}`;
      g.fillText('2026年刊 · ¥20', mx + mw / 2, my + mh - 7);
    });
  }

  // ============================================================================
  // 4. SLOTS.pachinko ([2048, 1024, 2048, 1024]): 武林国风电玩城 (Wulin Arcade)
  // ============================================================================
  {
    const [px, py, pw, ph] = SLOTS.pachinko;
    const machines = [
      { x: 18, w: 372, title: '钱塘群侠传', sub: '剑指武林 · 巅峰对决', center: '决战武林之巅', bg: '#78121c', acc: '#ffd048' },
      { x: 420, w: 382, title: '西湖寻宝记', sub: '三潭印月 · 瑞兽呈祥', center: '西湖秘宝 · 大奖', bg: '#124868', acc: '#58f0ff' },
      { x: 830, w: 382, title: '大圣归来', sub: '齐天大圣 · 破阵降魔', center: '金箍破阵 · 连击', bg: '#281838', acc: '#ff9838' },
      { x: 1244, w: 382, title: '九州仙侠录', sub: '御剑乘风 · 烟雨人间', center: '御剑九州 · 仙缘', bg: '#381632', acc: '#ff78d8' },
      { x: 1656, w: 374, title: '瑞狮呈祥', sub: '金狮献瑞 · 鸿运当头', center: '金狮献瑞 · 满贯', bg: '#482c08', acc: '#ffe058' },
    ];
    machines.forEach((m) => {
      // Top marquee header (`y: 4..156`)
      const mg = g.createLinearGradient(px + m.x, py + 4, px + m.x, py + 154);
      mg.addColorStop(0, m.bg); mg.addColorStop(1, '#120e10');
      g.fillStyle = mg;
      g.fillRect(px + m.x, py + 4, m.w, 150);
      g.strokeStyle = m.acc; g.lineWidth = 4;
      g.strokeRect(px + m.x + 4, py + 8, m.w - 8, 142);
      g.fillStyle = '#ffffff'; g.font = `900 44px ${SERIF_CN}`;
      g.fillText(m.title, px + m.x + m.w / 2, py + 48);
      g.fillStyle = m.acc; g.font = `700 20px ${SANS_CN}`;
      g.fillText(m.sub, px + m.x + m.w / 2, py + 86);
      // Digital score counter
      g.fillStyle = '#0a0808';
      g.fillRect(px + m.x + 86, py + 104, m.w - 172, 38);
      g.fillStyle = '#ff3828'; g.font = `900 28px ${SANS_CN}`;
      g.fillText('888  连胜', px + m.x + m.w / 2, py + 124);

      // Center screen overlay (`y: 320..610`)
      const cx = px + m.x + m.w / 2, cy = py + 475;
      const sg = g.createRadialGradient(cx, cy, 20, cx, cy, 138);
      sg.addColorStop(0, m.bg);
      sg.addColorStop(0.75, 'rgba(18, 14, 22, 0.92)');
      sg.addColorStop(1, 'rgba(18, 14, 22, 0)');
      g.fillStyle = sg;
      g.beginPath(); g.arc(cx, cy, 138, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.font = `900 36px ${SERIF_CN}`;
      g.fillText(m.center, cx, cy - 10);
      g.fillStyle = m.acc; g.font = `800 22px ${SANS_CN}`;
      g.fillText('杭州武林游艺中心', cx, cy + 36);

      // Bottom plaque (`y: 958..1016`)
      g.fillStyle = '#e8e2d8';
      g.fillRect(px + m.x + 14, py + 960, m.w - 28, 52);
      g.fillStyle = '#221c18'; g.font = `800 18px ${SANS_CN}`;
      g.fillText('国风益智游艺 · 适度休闲娱乐', px + m.x + m.w / 2, py + 986);
    });
  }

  // ============================================================================
  // 5. SLOTS.shelves ([0, 2048, 2048, 1024]): 江南特产与便利店货架 (Chinese Retail Shelves)
  // ============================================================================
  {
    const [sx, sy, sw, sh] = SLOTS.shelves;
    g.fillStyle = '#1e2024';
    g.fillRect(sx, sy, sw, sh);
    const tiers = [
      { y: 12, h: 176, items: [
        ['西湖龙井礼盒', '#185838', '#f4e6c0'], ['狮峰明前茶', '#246844', '#fff4d4'], ['九曲红梅茶', '#8c1c20', '#ffe8c0'],
        ['径山抹茶粉', '#2e7c48', '#e8f8e0'], ['桂花乌龙茶', '#c87818', '#fff8e0'], ['虎跑泉水茶包', '#1c4878', '#d8f0ff'],
        ['胎菊王礼盒', '#b88818', '#fff8d8'], ['安吉白茶礼', '#386858', '#f0f8f0'], ['陈皮白茶饼', '#68381c', '#f8e4c8'],
        ['西湖藕粉羹', '#a82838', '#ffeef0'], ['桂花糖藕礼', '#c85820', '#fff2d8'], ['知味定胜糕', '#b81e28', '#fff6e4'],
      ] },
      { y: 218, h: 176, items: [
        ['片儿川方便面', '#b82222', '#fff8e0'], ['虾爆鳝拌面', '#8c2818', '#ffe8c8'], ['葱油拌面王', '#285838', '#f0f8e8'],
        ['知味鲜肉小笼', '#c83228', '#fff6e8'], ['东坡肉自热饭', '#682418', '#f8e2c0'], ['笋干老鸭煲面', '#1e4838', '#e8f4e8'],
        ['雪菜笋片汤面', '#246858', '#e8f8f0'], ['蟹黄拌面礼盒', '#d87818', '#fff8e0'], ['红烧牛肉汤面', '#9c1c1c', '#ffe8d8'],
        ['桂花酒酿圆子', '#882848', '#ffeef8'], ['红油抄手碗面', '#b82818', '#fff0d8'], ['老杭州猫耳朵', '#583820', '#f4e8d0'],
      ] },
      { y: 424, h: 176, items: [
        ['龙井茶酥', '#286842', '#f4ebd0'], ['桂花绿豆糕', '#c88c24', '#fff8e0'], ['南宋桃酥礼', '#9c3228', '#ffe8d8'],
        ['黑芝麻薄脆', '#282a30', '#e8e4dc'], ['咸蛋黄肉松酥', '#d87818', '#fff6e0'], ['临安山核桃仁', '#684224', '#f4e4c8'],
        ['天目山笋干', '#385832', '#e8f2e0'], ['蜜汁豆腐干', '#78321c', '#f8e4d0'], ['西湖樱花酥', '#c85878', '#fff0f4'],
        ['抹茶牛乳饼', '#327848', '#e8f8e8'], ['榛子黑巧克力', '#382218', '#f0dfc8'], ['海盐芝士饼干', '#245888', '#e8f4ff'],
      ] },
      { y: 630, h: 176, items: [
        ['冷泡龙井茶', '#1e7848', '#ffffff'], ['冰镇酸梅汤', '#581c28', '#ffd888'], ['虎跑天然矿泉', '#1868b8', '#ffffff'],
        ['桂花乌龙茶饮', '#c87818', '#fff8e0'], ['竹叶青绿茶', '#288848', '#e8ffe8'], ['冰糖雪梨饮', '#d89820', '#fffce8'],
        ['青柠气泡水', '#188878', '#e8fff8'], ['鲜榨杨梅汁', '#8c1838', '#ffe0e8'], ['醇香拿铁咖啡', '#482c1c', '#f4e4d0'],
        ['黑糖珍珠奶茶', '#583824', '#f8ead8'], ['蜜桃乌龙果茶', '#d85878', '#fff0f4'], ['无糖美式咖啡', '#1e2024', '#dfbe7f'],
      ] },
      { y: 836, h: 164, items: [
        ['杭罗真丝方巾', '#183258', '#f4e6c8'], ['苏式檀香折扇', '#583820', '#f4ebd4'], ['西湖绸伞文创', '#185858', '#e8f8f4'],
        ['西泠印泥礼盒', '#9c1c1c', '#fff4e0'], ['竹编茶道茶盘', '#485832', '#eef4e4'], ['青瓷品茗杯组', '#488878', '#eef8f4'],
        ['宋韵香囊礼盒', '#782238', '#ffe8f0'], ['手工桂花香膏', '#b87820', '#fff6e0'], ['水墨江南画签', '#2c3036', '#f0ece4'],
        ['钱塘刺绣团扇', '#882832', '#ffeef0'], ['紫砂便携茶具', '#583020', '#f4e2d0'], ['武林夜市纪念章', '#8c6820', '#fff8dc'],
      ] },
    ];
    tiers.forEach((tier, tIdx) => {
      const cw = sw / tier.items.length;
      tier.items.forEach(([name, bg, fg], i) => {
        const ix = sx + i * cw + 8;
        const iy = sy + tier.y;
        const iw = cw - 16, ih = tier.h - 28;
        g.fillStyle = bg;
        g.beginPath(); g.roundRect(ix, iy, iw, ih, 10); g.fill();
        g.strokeStyle = fg; g.lineWidth = 2;
        g.strokeRect(ix + 6, iy + 6, iw - 12, ih - 12);
        g.fillStyle = fg; g.font = `900 22px ${SERIF_CN}`;
        g.fillText(name.slice(0, 4), ix + iw / 2, iy + ih * 0.42);
        if (name.length > 4) {
          g.font = `700 18px ${SANS_CN}`;
          g.fillText(name.slice(4), ix + iw / 2, iy + ih * 0.72);
        }
      });
      // Shelf rail with RMB prices
      const ry = sy + tier.y + tier.h - 22;
      g.fillStyle = '#dde2e6';
      g.fillRect(sx, ry, sw, 20);
      tier.items.forEach((_, i) => {
        g.fillStyle = '#181c20'; g.font = `800 13px ${SANS_CN}`;
        g.fillText(`¥${15 + (tIdx * 7 + i * 3) % 45}.0`, sx + (i + 0.5) * cw, ry + 10);
      });
    });
  }

  // ============================================================================
  // 6. SLOTS.shutter ([2048, 2048, 1024, 1024]): 临街金属卷帘门 (Chinese Street Shutter)
  // ============================================================================
  {
    const [shx, shy, shw, shh] = SLOTS.shutter;
    g.fillStyle = '#484c50';
    g.fillRect(shx, shy, shw, shh);
    // Horizontal corrugated steel slats
    const slats = 38;
    const slatH = shh / slats;
    for (let i = 0; i < slats; i++) {
      const y0 = shy + i * slatH;
      const sg = g.createLinearGradient(shx, y0, shx, y0 + slatH);
      sg.addColorStop(0, '#62666a');
      sg.addColorStop(0.45, '#4e5256');
      sg.addColorStop(0.85, '#34383b');
      sg.addColorStop(1, '#222528');
      g.fillStyle = sg;
      g.fillRect(shx, y0, shw, slatH);
    }
    // Subtle vertical weathering & center lock slot
    const vGrad = g.createLinearGradient(shx, shy, shx, shy + shh);
    vGrad.addColorStop(0, 'rgba(20, 18, 16, 0.35)');
    vGrad.addColorStop(0.6, 'rgba(0, 0, 0, 0)');
    vGrad.addColorStop(1, 'rgba(28, 22, 18, 0.55)');
    g.fillStyle = vGrad;
    g.fillRect(shx, shy, shw, shh);

    // Authentic Chinese shop notices & plaques on the shutter
    const notices = [
      { x: 96, y: 180, w: 220, h: 310, bg: '#8c1c1e', fg: '#fff6e0', t1: '武林夜市', t2: '每晚七时开市', t3: '传统百货 · 茗茶小食' },
      { x: 680, y: 210, w: 230, h: 140, bg: '#f0eadc', fg: '#1a1816', t1: '门前通道', t2: '请勿泊车', t3: '谢谢街坊配合' },
      { x: 380, y: 420, w: 260, h: 160, bg: '#183628', fg: '#f4e6c0', t1: '西湖龙井茶行', t2: '明前新茶上市', t3: '批零兼营 · 欢迎品茗' },
    ];
    notices.forEach((n) => {
      g.fillStyle = n.bg;
      g.fillRect(shx + n.x, shy + n.y, n.w, n.h);
      g.strokeStyle = n.fg; g.lineWidth = 4;
      g.strokeRect(shx + n.x + 8, shy + n.y + 8, n.w - 16, n.h - 16);
      g.fillStyle = n.fg; g.font = `900 32px ${SERIF_CN}`;
      g.fillText(n.t1, shx + n.x + n.w / 2, shy + n.y + n.h * 0.32);
      g.font = `800 24px ${SANS_CN}`;
      g.fillText(n.t2, shx + n.x + n.w / 2, shy + n.y + n.h * 0.60);
      g.font = `600 17px ${SANS_CN}`;
      g.fillText(n.t3, shx + n.x + n.w / 2, shy + n.y + n.h * 0.82);
    });
    // Bottom handle plate
    g.fillStyle = '#242628';
    g.fillRect(shx + shw / 2 - 70, shy + shh - 96, 140, 38);
    g.strokeStyle = '#787c80'; g.lineWidth = 3;
    g.strokeRect(shx + shw / 2 - 70, shy + shh - 96, 140, 38);
  }

  // ============================================================================
  // 7. SLOTS.vending ([3072, 2048, 512, 1024]): 西子智饮 · 24小时自助茶饮机
  // ============================================================================
  {
    const [vx, vy, vw, vh] = SLOTS.vending;
    g.fillStyle = '#f2eee6';
    g.fillRect(vx, vy, vw, vh);
    // Top Chinese brand header (`y: 0..68`)
    const hg = g.createLinearGradient(vx, vy, vx + vw, vy);
    hg.addColorStop(0, '#9c1c22'); hg.addColorStop(0.5, '#b8242a'); hg.addColorStop(1, '#8c181e');
    g.fillStyle = hg;
    g.fillRect(vx + 6, vy + 6, vw - 12, 58);
    g.fillStyle = '#fff8ea'; g.font = `900 32px ${SERIF_CN}`;
    g.fillText('西子智饮 · 江南冷泡茗茶', vx + vw / 2, vy + 36);

    // Illuminated beverage display window (`y: 70..540`)
    g.fillStyle = '#e6f0f4';
    g.fillRect(vx + 16, vy + 70, vw - 32, 468);
    const vRows = [
      [['龙井茶', '#1e7848'], ['桂花茶', '#c88218'], ['虎跑水', '#1c78c8'], ['酸梅汤', '#681c2c'], ['红梅茶', '#9c2228'], ['茉莉茶', '#388858']],
      [['冰拿铁', '#4e321e'], ['鲜橙汁', '#e07818'], ['蜜桃茶', '#d85878'], ['青柠水', '#228878'], ['乌龙茶', '#784820'], ['美式咖', '#222428']],
      [['椰子水', '#1c6898'], ['雪梨饮', '#c89824'], ['杨梅汁', '#8c1838'], ['苏打水', '#2878a8'], ['抹茶饮', '#2e7842'], ['桂花酿', '#b86820']],
    ];
    vRows.forEach((row, rIdx) => {
      const ry = vy + 82 + rIdx * 152;
      const bw = (vw - 48) / row.length;
      row.forEach(([name, col], cIdx) => {
        const bx = vx + 24 + cIdx * bw + 6;
        const w = bw - 12;
        // Bottle silhouette
        g.fillStyle = col;
        g.fillRect(bx + w * 0.28, ry, w * 0.44, 14);
        g.beginPath(); g.roundRect(bx + 2, ry + 12, w - 4, 92, 10); g.fill();
        g.fillStyle = '#fff8ee';
        g.fillRect(bx + 4, ry + 34, w - 8, 52);
        drawVerticalText(g, name, bx + w / 2, ry + 38, ry + 82, `900 16px ${SERIF_CN}`, col);
        // Price & button
        g.fillStyle = '#182028';
        g.fillRect(bx, ry + 108, w, 20);
        g.fillStyle = '#ffffff'; g.font = `700 13px ${SANS_CN}`;
        g.fillText('¥5.0', bx + w / 2, ry + 118);
        g.fillStyle = '#1890d8';
        g.beginPath(); g.roundRect(bx + 8, ry + 131, w - 16, 12, 6); g.fill();
      });
    });

    // Lower left promotional panel (`y: 552..768`)
    const lg = g.createLinearGradient(vx + 16, vy + 552, vx + 236, vy + 768);
    lg.addColorStop(0, '#b82228'); lg.addColorStop(1, '#781216');
    g.fillStyle = lg;
    g.fillRect(vx + 16, vy + 552, 224, 216);
    g.strokeStyle = '#dfbe7f'; g.lineWidth = 3;
    g.strokeRect(vx + 22, vy + 558, 212, 204);
    g.fillStyle = '#fff8ea'; g.font = `900 38px ${SERIF_CN}`;
    g.fillText('品味江南', vx + 128, vy + 618);
    g.fillText('四季好茶', vx + 128, vy + 668);
    g.fillStyle = '#ffd888'; g.font = `700 16px ${SANS_CN}`;
    g.fillText('杭州武林夜市便民驿站', vx + 128, vy + 728);

    // Lower right payment & QR module (`x: 254..496, y: 552..768`)
    g.fillStyle = '#24282c';
    g.beginPath(); g.roundRect(vx + 254, vy + 552, 240, 146, 12); g.fill();
    g.fillStyle = '#0e1812';
    g.fillRect(vx + 272, vy + 568, 96, 32);
    g.fillStyle = '#38e878'; g.font = `800 16px ${SANS_CN}`;
    g.fillText('营业中', vx + 320, vy + 584);
    g.fillStyle = '#e8eef2';
    g.fillRect(vx + 272, vy + 610, 96, 74);
    g.fillStyle = '#182028'; g.font = `700 13px ${SANS_CN}`;
    g.fillText('扫码支付', vx + 320, vy + 634);
    g.fillText('微信 / 支付宝', vx + 320, vy + 658);
    g.fillStyle = '#dfbe7f'; g.font = `700 14px ${SANS_CN}`;
    g.fillText('纸币 / 硬币口', vx + 432, vy + 610);
    g.fillStyle = '#121416';
    g.fillRect(vx + 388, vy + 630, 88, 48);
    g.strokeStyle = '#e89828'; g.lineWidth = 2;
    g.strokeRect(vx + 392, vy + 634, 80, 40);
    g.fillStyle = '#e89828'; g.font = `700 13px ${SANS_CN}`;
    g.fillText('人民币 5/10元', vx + 432, vy + 654);

    // Eco notice badge (`x: 396..496, y: 706..776`)
    g.fillStyle = '#e4ece8';
    g.fillRect(vx + 392, vy + 706, 102, 68);
    g.strokeStyle = '#287858'; g.lineWidth = 2;
    g.strokeRect(vx + 394, vy + 708, 98, 64);
    g.fillStyle = '#185838'; g.font = `700 13px ${SANS_CN}`;
    g.fillText('绿色环保机身', vx + 443, vy + 728);
    g.fillText('空瓶请投回收箱', vx + 443, vy + 752);

    // Pickup bin (`y: 788..918`)
    g.fillStyle = '#202428';
    g.fillRect(vx + 26, vy + 788, vw - 52, 128);
    g.strokeStyle = '#687078'; g.lineWidth = 3;
    g.strokeRect(vx + 32, vy + 794, vw - 64, 116);
    g.fillStyle = '#d8e0e8'; g.font = `800 20px ${SANS_CN}`;
    g.fillText('请在此处取走饮品 · 注意防夹手', vx + vw / 2, vy + 852);
    // Bottom serial tag
    g.fillStyle = '#cfd4d8';
    g.fillRect(vx + 396, vy + 940, 98, 42);
    g.fillStyle = '#282c30'; g.font = `700 11px ${SANS_CN}`;
    g.fillText('西子智饮 08号机', vx + 445, vy + 960);
  }

  // ============================================================================
  // 8. SLOTS.noren ([3584, 2048, 512, 256]): 江南布帘 (Full-height 4-panel Chinese Noren)
  // ============================================================================
  {
    const [nx, ny, nw, nh] = SLOTS.noren;
    g.fillStyle = '#0e0a08';
    g.fillRect(nx, ny, nw, nh);
    const flaps = ['知', '味', '雅', '座'];
    const fw = nw / 4;
    for (let i = 0; i < 4; i++) {
      const fx = nx + i * fw + 4;
      const w = fw - 8;
      const fg = g.createLinearGradient(fx, ny + 8, fx, ny + nh - 8);
      fg.addColorStop(0, '#182842');
      fg.addColorStop(1, '#101b2e');
      g.fillStyle = fg;
      g.fillRect(fx, ny + 8, w, nh - 16);
      g.strokeStyle = '#dfbe7f'; g.lineWidth = 3;
      g.strokeRect(fx + 8, ny + 16, w - 16, nh - 32);
      g.beginPath(); g.arc(fx + w / 2, ny + nh * 0.52, 44, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f8f0dc';
      g.font = `900 64px ${SERIF_CN}`;
      g.fillText(flaps[i], fx + w / 2, ny + nh * 0.53);
      g.fillStyle = '#dfbe7f';
      g.font = `700 15px ${SANS_CN}`;
      g.fillText('杭州老字号', fx + w / 2, ny + 34);
    }
  }

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
