// 杭州武林夜市 — 现代中国人日常穿搭、纹理与晴雨伞样式系统
// 保留写实人体与现代日常服饰网格（连帽卫衣、城市冲锋衣、休闲夹克、风衣、T恤牛仔裤、运动鞋、智能手机），
// 去除赛博朋克霓虹发光条与欧美金发，赋予符合现代杭州街头青年与市民的自然发色与日常配色。
import * as THREE from 'three/webgpu';

const _texCache = new Map();

// ---------------------------------------------------------------------------
// 1. Clean Modern Casual Fabric Texture (replaces formal Western necktie suit)
// ---------------------------------------------------------------------------
export function getHanfuBrocadeTexture(kind = 'casual') {
  const key = 'modern_cloth_' + kind;
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const g = c.getContext('2d');

  // Clean modern cotton/knit weave neutral base so tintU controls color naturally
  g.fillStyle = '#eceae4';
  g.fillRect(0, 0, 256, 256);

  // Subtle modern cotton jersey / twill weave micro-texture
  g.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  g.lineWidth = 1;
  for (let y = 0; y < 256; y += 3) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(256, y);
    g.stroke();
  }
  g.strokeStyle = 'rgba(0, 0, 0, 0.04)';
  for (let x = 0; x < 256; x += 3) {
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x, 256);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.flipY = false;
  tex.needsUpdate = true;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// 2. Modern Everyday Umbrellas (透明雨伞 / 简约黑胶晴雨伞 / 莫兰迪拼色折叠伞)
// ---------------------------------------------------------------------------
export function getWestLakeUmbrellaTexture(kind = 'clear') {
  const key = 'modern_umb_' + kind;
  if (_texCache.has(key)) return _texCache.get(key);
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 512;
  const g = c.getContext('2d');
  const cx = 256, cy = 256;

  if (kind === 'clear') {
    // 现代便利店透明雨伞 (Frosted translucent vinyl umbrella with white trim)
    const grad = g.createRadialGradient(cx, cy, 12, cx, cy, 250);
    grad.addColorStop(0.0, '#d8e2e8');
    grad.addColorStop(0.75, '#eef3f6');
    grad.addColorStop(0.93, '#dce4ea');
    grad.addColorStop(1.0, '#f8fafc');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
  } else if (kind === 'black') {
    // 现代深灰藏青黑胶晴雨伞 (Minimalist matte navy-charcoal UV umbrella)
    const grad = g.createRadialGradient(cx, cy, 12, cx, cy, 250);
    grad.addColorStop(0.0, '#1e242b');
    grad.addColorStop(0.82, '#28303a');
    grad.addColorStop(0.95, '#343e4a');
    grad.addColorStop(1.0, '#1b2026');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
  } else {
    // 现代莫兰迪燕麦米拼雾霾蓝晴雨伞 (Contemporary Morandi oat-beige & mist-blue umbrella)
    const grad = g.createRadialGradient(cx, cy, 12, cx, cy, 250);
    grad.addColorStop(0.0, '#6e8596');
    grad.addColorStop(0.72, '#d8d2c7');
    grad.addColorStop(0.88, '#7b92a4');
    grad.addColorStop(1.0, '#5d7384');
    g.fillStyle = grad;
    g.fillRect(0, 0, 512, 512);
  }

  // 8 sleek modern metal umbrella ribs (现代八骨晴雨伞骨架)
  g.strokeStyle = kind === 'black' ? 'rgba(180, 190, 205, 0.22)' : 'rgba(110, 120, 130, 0.25)';
  g.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI * 2) / 8;
    g.beginPath();
    g.moveTo(cx, cy);
    g.lineTo(cx + Math.cos(a) * 250, cy + Math.sin(a) * 250);
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.needsUpdate = true;
  _texCache.set(key, tex);
  return tex;
}

// ---------------------------------------------------------------------------
// 3. Clean Up LOD1 Vertex Colors (Natural Chinese Hair, Modern Casual Colors, Zero Cyberpunk Neon)
// ---------------------------------------------------------------------------
function normalizeLod1ModernColors(mesh, sex, outfit) {
  const geo = mesh.geometry;
  if (!geo?.attributes?.color) return;
  const col = geo.attributes.color;
  const pos = geo.attributes.position;
  const matName = (mesh.material?.name || '').replace(/^crowd_/, '');

  if (matName.startsWith('hair')) {
    // Natural Chinese dark hair for distant VAT instances
    for (let i = 0; i < col.count; i++) {
      col.setXYZW(i, 0.065, 0.058, 0.052, 0.0);
    }
    col.needsUpdate = true;
    return;
  }

  if (matName.startsWith('trim_')) {
    // Eliminate cyberpunk neon emissive alpha mask (a = 0) and use clean white/silver zipper trim
    for (let i = 0; i < col.count; i++) {
      col.setXYZW(i, 0.85, 0.87, 0.90, 0.0);
    }
    col.needsUpdate = true;
    return;
  }

  const isGarmentPrim =
    matName.startsWith('cloth_') ||
    matName.startsWith('trench_') ||
    matName.startsWith('rain_') ||
    matName.startsWith('knit_') ||
    matName.startsWith('tech_');

  if (isGarmentPrim) {
    // Top vs bottom split at waist (y ~ 0.92) so distant VAT pedestrians have distinct modern tops & pants
    const topRGB =
      sex === 'female'
        ? outfit === 'f_hoodie'
          ? [0.88, 0.85, 0.80] // 燕麦奶白卫衣
          : outfit === 'f_trench'
          ? [0.78, 0.71, 0.60] // 经典卡其风衣
          : outfit === 'f_techwear'
          ? [0.82, 0.88, 0.92] // 冰川白/雾蓝防晒冲锋衣
          : outfit === 'f_raincoat'
          ? [0.84, 0.76, 0.78] // 浅樱粉休闲外套
          : [0.90, 0.88, 0.85] // 纯白/米白日常上衣
        : outfit === 'm_hoodie'
        ? [0.72, 0.74, 0.77]   // 高级灰连帽卫衣
        : outfit === 'm_jacket'
        ? [0.36, 0.44, 0.52]   // 牛仔蓝/工装夹克
        : outfit === 'm_trench'
        ? [0.68, 0.62, 0.54]   // 驼色/卡其休闲大衣
        : outfit === 'm_techwear'
        ? [0.34, 0.40, 0.36]   // 山系橄榄绿冲锋衣
        : [0.30, 0.35, 0.42];  // 藏青日常防风外套

    const botRGB =
      sex === 'female'
        ? [0.32, 0.42, 0.56]   // 现代牛仔蓝长裤/休闲裙裤
        : [0.24, 0.28, 0.34];  // 现代深灰/深蓝休闲长裤

    for (let i = 0; i < col.count; i++) {
      const y = pos ? pos.getY(i) : 1.0;
      const rgb = y < 0.92 ? botRGB : topRGB;
      col.setXYZW(i, rgb[0], rgb[1], rgb[2], 0.0);
    }
    col.needsUpdate = true;
  }
}

export function applyHanfuToEntry(entry) {
  const sex = entry.sex;
  const byName = entry.byName;

  // Keep base 3D human & modern casual clothing meshes 100% intact (no ancient skirts, no sleeve deformation, no hair buns).
  // Only clean up LOD1 vertex colors so distant VAT crowds have natural Chinese hair & zero cyberpunk neon glow.
  for (const outfit of entry.outfits) {
    const lodGrp = byName['outfit_' + outfit + '_lod1'];
    if (!lodGrp) continue;
    lodGrp.traverse((o) => {
      if (o.isSkinnedMesh) normalizeLod1ModernColors(o, sex, outfit);
    });
  }
}
