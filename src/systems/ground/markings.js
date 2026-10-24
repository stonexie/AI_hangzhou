// Japanese road-marking glyph atlas, rendered once to a canvas (white on black, R channel = paint mask).
// Cells (each CELL_W x CELL_H px, u across the lane, v = up = toward the intersection / direction of travel):
//   0 止まれ   1 straight+left arrow   2 straight+right arrow   3 "40"   4 ◇ crosswalk-ahead diamond   5 バス専用
import * as THREE from 'three/webgpu';

export const GLYPH = { STOP: 0, ARROW_L: 1, ARROW_R: 2, SPEED: 3, DIAMOND: 4, BUS: 5 };
export const N_CELLS = 6;
const CELL_W = 256, CELL_H = 768;

export function buildMarkingAtlas() {
  const cv = document.createElement('canvas');
  cv.width = CELL_W * N_CELLS; cv.height = CELL_H;
  const g = cv.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
  g.fillStyle = '#fff'; g.strokeStyle = '#fff';
  const font = (px) => `900 ${px}px "Yu Gothic", "YuGothic", "Meiryo", "MS Gothic", "Noto Sans JP", sans-serif`;

  // stretched text: drawn across the cell width, stretched along v (road markings are elongated ~2.5x)
  function text(cell, str, px, stretch, y0 = 0.5) {
    g.save();
    g.translate(cell * CELL_W + CELL_W / 2, CELL_H * y0);
    g.scale(1, stretch);
    g.font = font(px);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(str).width;
    const sx = Math.min(1, (CELL_W * 0.94) / w);
    g.scale(sx, 1);
    g.fillText(str, 0, 0);
    g.restore();
  }
  // stacked characters (vertical reading toward the driver: first char nearest the intersection = top)
  function stack(cell, chars, stretch) {
    const n = chars.length;
    const h = CELL_H / n;
    chars.forEach((ch, i) => {
      g.save();
      g.translate(cell * CELL_W + CELL_W / 2, h * (i + 0.5));
      g.scale(1, stretch);
      g.font = font(CELL_W * 0.9);
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(ch, 0, 0);
      g.restore();
    });
  }
  // Japanese "止まれ" is written across the lane: one line, chars stretched along the road.
  text(GLYPH.STOP, '止まれ', 92, 6.2);
  text(GLYPH.SPEED, '40', 210, 2.9);
  // バス専用: two rows (バス nearest intersection (top), 専用 below) - drivers read top->bottom as they approach
  g.save();
  text(GLYPH.BUS, 'バス', 120, 2.6, 0.27);
  text(GLYPH.BUS, '専用', 120, 2.6, 0.75);
  g.restore();

  // arrows: shaft from bottom to top, head at top; optional branch
  function arrow(cell, branch) {
    const ox = cell * CELL_W;
    const cx = ox + CELL_W * (branch ? (branch < 0 ? 0.62 : 0.38) : 0.5);
    const sw = 30;
    g.beginPath();
    g.rect(cx - sw / 2, CELL_H * 0.3, sw, CELL_H * 0.68);
    g.fill();
    // head
    g.beginPath();
    g.moveTo(cx, CELL_H * 0.02); g.lineTo(cx - 52, CELL_H * 0.32); g.lineTo(cx + 52, CELL_H * 0.32); g.closePath(); g.fill();
    if (branch) {
      // branch leaves the shaft at mid height, bends to the side (left = -1 / right = +1) and points upward-sideways
      const bx = cx + branch * 92;
      g.beginPath();
      g.moveTo(cx, CELL_H * 0.72);
      g.lineTo(cx, CELL_H * 0.62);
      g.lineTo(bx, CELL_H * 0.46);
      g.lineTo(bx, CELL_H * 0.56);
      g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(bx + branch * 34, CELL_H * 0.40);
      g.lineTo(bx - branch * 10, CELL_H * 0.36);
      g.lineTo(bx + branch * 2, CELL_H * 0.62);
      g.closePath(); g.fill();
    }
  }
  arrow(GLYPH.ARROW_L, -1);
  arrow(GLYPH.ARROW_R, 1);

  // diamond outline
  {
    const ox = GLYPH.DIAMOND * CELL_W;
    g.lineWidth = 34; g.lineJoin = 'miter';
    g.beginPath();
    g.moveTo(ox + CELL_W / 2, 30); g.lineTo(ox + CELL_W - 40, CELL_H / 2); g.lineTo(ox + CELL_W / 2, CELL_H - 30); g.lineTo(ox + 40, CELL_H / 2); g.closePath();
    g.stroke();
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.anisotropy = 16;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}
