// Decides which signs go on which facade (district aware, deterministic).
import * as THREE from 'three/webgpu';
import { NEON } from './util.js';

export function populateFacades(sb, facades, L, layout) {
  const rnd = sb.rnd;
  const lib = sb.lib;
  const pickNeonV = () => rnd.pick(lib.neonV);
  const pickBoxV = () => rnd.pick(lib.boxV);
  const used = [];

  for (const f of facades) {
    const base = f.center.y - f.height / 2;
    const top = f.center.y + f.height / 2;
    const w = f.width;
    const d = f.district;
    if (w < 3 || f.height < 5) continue;
    const detail = f.detail || 'hi';
    let dense = d === 'avenue' ? 1 : d === 'alley' ? 0.9 : d === 'cross' ? 0.7 : 0.3;
    if (detail === 'mid') dense *= 0.3;
    if (f.lane) dense *= 0.5;
    if (detail === 'lo') {
      // background blocks: only an occasional big sign so the skyline/back streets are not dead
      if (rnd() < 0.05 && w > 10) sb.rooftop(f, rnd.pick(lib.chanH), { width: Math.min(w * 0.8, rnd.range(8, 14)) });
      else if (rnd() < 0.05) sb.flat(f, 0, base + f.height * rnd.range(0.4, 0.8), rnd.pick(lib.neonH), { width: rnd.range(4, 8), maxH: 2.5, depth: 0.1, importance: 0.5 });
      continue;
    }
    if (rnd() > Math.min(1, dense * 1.6)) continue;
    const lightMul = 1;
    sb.lightScale = d === 'alley' ? 0.5 : d === 'cross' ? 0.8 : 1;

    // ---- shopfront fascia (light box or neon on dark fascia) mounted on the building's fascia band
    if (f.shopfront && rnd() < 0.85 * dense + 0.1) {
      const yc = f.fasciaY != null ? f.fasciaY + 0.15 : base + (d === 'alley' ? 2.9 : 3.5);
      const neonFascia = rnd() < 0.3;
      if (neonFascia) {
        const ds = rnd.pick(lib.neonH);
        sb.flat(f, rnd.range(-0.1, 0.1) * w, yc, ds, { width: Math.min(w * 0.75, 6), maxH: 1.1, depth: 0.15, housing: [[0.02, 0.02, 0.022], [0.4, 0.5]] });
      } else {
        const ds = rnd() < 0.7 ? rnd.pick(lib.boxH) : rnd.pick(lib.boxSq);
        const maxH = ds.aspect < 1.5 ? 1.6 : 1.0;
        sb.flat(f, rnd.range(-0.1, 0.1) * w, yc + (maxH > 1.2 ? 0.3 : 0), ds, { width: Math.min(w * 0.8, 6.5), maxH });
      }
    }

    // ---- vertical blades (focused on 1F-2F street level, avoiding cluttered canyon walls)
    const nBlades = Math.max(0, Math.round((w / 10.5) * dense * rnd.range(0.6, 1.1)));
    const slots = [];
    for (let i = 0; i < nBlades; i++) slots.push(-w / 2 + 1.0 + (w - 2.0) * ((i + rnd.range(0.25, 0.75)) / Math.max(1, nBlades)));
    // occasional landmark vertical banner on tall avenue corners
    if (d === 'avenue' && f.height > 22 && rnd() < 0.2) {
      const a = (rnd() < 0.5 ? -1 : 1) * (w / 2 - 0.9);
      const y0 = base + rnd.range(6.5, 9.5);
      const room = top - y0 - 1;
      if (room > 6) sb.blade(f, a, y0, rnd() < 0.65 ? pickNeonV() : pickBoxV(), { depth: rnd.range(1.2, 1.8), maxH: Math.min(room, rnd.range(6, 10)), thick: 0.4, edge: rnd() < 0.5, importance: 1.3 });
    }
    for (const a of slots) {
      const y0 = base + (d === 'alley' ? rnd.range(3.0, 4.2) : rnd.range(3.8, 5.2));
      const room = top - y0 - 0.8;
      if (room < 1.8) continue;
      const ds = rnd() < 0.55 ? pickNeonV() : pickBoxV();
      sb.blade(f, a, y0, ds, { maxH: Math.min(room, d === 'alley' ? 4.0 : rnd.range(3.2, 6.2)), depth: d === 'alley' ? rnd.range(0.55, 0.85) : undefined, lightMul });
    }

    // ---- 2F plaque / traditional lightbox only (keep 3F+ upper walls clean; no cyber icons or purple screens)
    const floors = Math.floor(f.height / f.floorHeight);
    if (floors > 3 && rnd() < 0.22 * dense) {
      const yc = base + 2 * f.floorHeight + f.floorHeight * 0.45;
      const a = rnd.range(-0.25, 0.25) * w;
      if (rnd() < 0.45) sb.flat(f, a, yc, rnd.pick(lib.neonH), { width: rnd.range(2.4, Math.min(5.5, w * 0.65)), maxH: 1.5, depth: 0.1 });
      else sb.flat(f, a, yc, rnd.pick(lib.boxSq), { width: rnd.range(1.5, 2.2) });
    }

    // ---- posters on ground floor walls (painted)
    if ((d === 'alley' || d === 'cross') && lib.posters.length && rnd() < 0.6) {
      const n = rnd.int(1, 4);
      for (let i = 0; i < n; i++) {
        const p = rnd.pick(lib.posters);
        const fa = rnd.range(-0.45, 0.45) * w;
        sb.flat(f, fa, base + rnd.range(1.2, 1.9), p, { width: rnd.range(0.5, 0.75), depth: 0.004, off: 0.005, noHousing: true, light: false, inten: 0.04, tint: [0.85, 0.85, 0.85] });
      }
    }

    // ---- rooftop letters
    if (d !== 'alley' && f.height < 45 && w > 10 && rnd() < 0.18 * dense + 0.04) {
      sb.rooftop(f, rnd.pick(lib.chanH), { width: Math.min(w * 0.8, rnd.range(8, 14)) });
    }
    used.push(f);
  }
  sb.lightScale = 1;
  return used;
}
