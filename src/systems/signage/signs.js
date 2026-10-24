// Facade-mounted signs: neon blades, light-box blades, fascias, wall neon, tenant stacks, rooftop letters.
// Everything is written into two batches (faces + housings) => 2 draw calls for all facade signage.
import * as THREE from 'three/webgpu';
import { NEON, NEON_WEIGHTS } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

const HOUSING_COLS = [
  [[0.025, 0.025, 0.028], [0.5, 0.45]], [[0.04, 0.04, 0.045], [0.6, 0.4]], [[0.3, 0.3, 0.32], [0.85, 0.35]],
  [[0.5, 0.5, 0.5], [0.0, 0.5]], [[0.35, 0.03, 0.03], [0.2, 0.45]], [[0.03, 0.05, 0.12], [0.3, 0.45]], [[0.6, 0.6, 0.62], [0.1, 0.4]],
];

export class SignBuilder {
  constructor(lib, faces, housing, pool, rnd) {
    this.lib = lib; this.F = faces; this.H = housing; this.pool = pool; this.rnd = rnd;
    this.seed = 1;
    this.stats = { signs: 0, lights: 0 };
    this.lightScale = 1; // per-district light multiplier (set by populate/featured)
  }

  nextSeed() { this.seed = (this.seed % 997) + 1; return this.seed; }
  neonColor() { return NEON[this.rnd.weighted(NEON_WEIGHTS)]; }
  ftype(p = {}) {
    const r = this.rnd();
    if (r < (p.broken ?? 0.12)) return 2;
    if (r < (p.broken ?? 0.12) + (p.stutter ?? 0.08)) return 1;
    if (r < (p.broken ?? 0.12) + (p.stutter ?? 0.08) + (p.breathe ?? 0.06)) return 4;
    return 0;
  }

  // ---- primitives -------------------------------------------------------
  hbox(c, ax, h, col, mr, skip) { this.H.box(c, ax, h, { col, mr }, skip); }

  bar(a, b, r, col, mr = [0.8, 0.4]) { // square steel bar between two points
    const d = b.clone().sub(a); const L = d.length(); if (L < 1e-4) return;
    const z = d.normalize();
    const x = Math.abs(z.y) < 0.9 ? new THREE.Vector3().crossVectors(UP, z).normalize() : V(1, 0, 0);
    const y = new THREE.Vector3().crossVectors(z, x).normalize();
    this.hbox(a.clone().add(b).multiplyScalar(0.5), [x, y, z], [r, r, L / 2], col, mr);
  }

  face(c, u, v, hu, hv, n, design, tint, inten, seed, ftype, back = [0.02, 0.02, 0.025]) {
    this.F.quad(c, u, v, hu, hv, n, design.rect.uv, { tint, sp: [design.mode, inten, seed, ftype], back });
  }

  strip(c, u, v, hu, hv, n, tint, inten, seed, ftype) {
    // solid emissive: uv irrelevant (use a pixel known to be black in colour atlas is not needed: mode 2 ignores textures)
    this.F.quad(c, u, v, hu, hv, n, [0, 0, 0.0001, 0.0001], { tint, sp: [2, inten, seed, ftype], back: [0, 0, 0] });
  }

  light(pos, color, intensity, distance, seed, ftype, importance = 1) {
    this.pool.add({ pos, color, intensity: intensity * this.lightScale, distance, seed, ftype, importance });
    this.stats.lights++;
  }

  // ---- sign types -------------------------------------------------------
  // Vertical blade perpendicular to the facade. f: facade, a: offset along right, y0: bottom, design, opts
  blade(f, a, y0, design, o = {}) {
    const rnd = this.rnd;
    const n = f.normal, r = f.right;
    const isNeon = design.mode === 0;
    let D = o.depth ?? rnd.range(0.75, 1.25);
    let Hh = D / design.aspect;
    const maxH = o.maxH ?? 9;
    if (Hh > maxH) { Hh = maxH; D = Hh * design.aspect; }
    const T = o.thick ?? (isNeon ? rnd.range(0.18, 0.3) : rnd.range(0.25, 0.4));
    const gap = o.gap ?? rnd.range(0.25, 0.5);
    const base = f.center.clone().addScaledVector(r, a);
    base.y = y0 + Hh / 2;
    const c = base.clone().addScaledVector(n, gap + D / 2);
    const [hcol, hmr] = o.housing ?? (isNeon ? HOUSING_COLS[rnd.int(0, 2)] : rnd.pick(HOUSING_COLS));
    const fr = 0.05; // frame border
    // housing body (skip faces where art goes)
    this.hbox(c, [r, UP, n], [T / 2, Hh / 2 + fr, D / 2 + fr], hcol, hmr, new Set(['+x', '-x']));
    // frame bars on both sides
    for (const s of [-1, 1]) {
      const fc = c.clone().addScaledVector(r, s * (T / 2 + 0.015));
      this.hbox(fc.clone().addScaledVector(UP, Hh / 2 + fr / 2), [r, UP, n], [0.02, fr / 2, D / 2 + fr], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(UP, -Hh / 2 - fr / 2), [r, UP, n], [0.02, fr / 2, D / 2 + fr], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(n, D / 2 + fr / 2), [r, UP, n], [0.02, Hh / 2, fr / 2], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(n, -D / 2 - fr / 2), [r, UP, n], [0.02, Hh / 2, fr / 2], hcol, hmr);
    }
    const tint = o.tint ?? (isNeon ? this.neonColor() : [1, 1, 1]);
    const seed = this.nextSeed();
    const ft = o.ftype ?? this.ftype(isNeon ? {} : { broken: 0.0, stutter: 0.06, breathe: 0 });
    const inten = o.inten ?? (isNeon ? rnd.range(5, 8) : rnd.range(1.6, 2.4));
    const back = isNeon ? [hcol[0] * 0.6 + 0.008, hcol[1] * 0.6 + 0.008, hcol[2] * 0.6 + 0.01] : [0.02, 0.02, 0.02];
    // art faces: +r face uses u = -n, -r face uses u = +n (text reads correctly from both sides)
    this.face(c.clone().addScaledVector(r, T / 2 + 0.003), n.clone().negate(), UP, D / 2, Hh / 2, r, design, tint, inten, seed, ft, back);
    this.face(c.clone().addScaledVector(r, -T / 2 - 0.003), n.clone(), UP, D / 2, Hh / 2, r.clone().negate(), design, tint, inten, seed, ft, back);
    // LED edge strip on outer edge (some)
    if (o.edge ?? rnd() < 0.45) {
      const ec = isNeon ? tint : this.neonColor();
      this.strip(c.clone().addScaledVector(n, D / 2 + fr + 0.004), r, UP, T * 0.32, Hh / 2 + fr, n, ec, rnd.range(2.5, 4.5), seed, ft);
    }
    // brackets: top & bottom arms + diagonal brace
    const steel = [[0.18, 0.18, 0.19], [0.8, 0.45]];
    for (const yy of [Hh / 2 - 0.12, -Hh / 2 + 0.12]) {
      const p0 = base.clone().addScaledVector(UP, yy);
      this.bar(p0, p0.clone().addScaledVector(n, gap + 0.02), 0.03, ...steel);
      this.hbox(p0.clone().addScaledVector(n, 0.01), [r, UP, n], [0.08, 0.08, 0.01], ...steel);
    }
    if (Hh > 3) {
      const mid = base.clone();
      this.bar(mid, mid.clone().addScaledVector(n, gap + 0.02), 0.025, ...steel);
    }
    // cast light (out from the blade on both sides -> centre slightly outward)
    const lp = c.clone().addScaledVector(n, 0.2);
    lp.y = Math.max(y0 + Hh * 0.35, y0 + 0.5);
    const lc = isNeon ? tint : (o.lightColor ?? [1, 0.85, 0.7]);
    this.light(lp, lc, (isNeon ? 9 : 7) * Math.sqrt(D * Hh) * (o.lightMul ?? 1), Math.min(20, 9 + Hh * 1.3), seed, ft, o.importance ?? 1);
    this.stats.signs++;
    return { c, D, Hh, top: y0 + Hh };
  }

  // Flat sign on the wall facing out. yc = centre height. W = desired width (height derived from aspect)
  flat(f, a, yc, design, o = {}) {
    const rnd = this.rnd;
    const n = f.normal, r = f.right;
    const isNeon = design.mode === 0 || design.mode === 4;
    let W = o.width ?? 3; let Hh = W / design.aspect;
    if (o.maxH && Hh > o.maxH) { Hh = o.maxH; W = Hh * design.aspect; }
    const Dp = o.depth ?? (isNeon ? 0.12 : rnd.range(0.2, 0.35));
    const c = f.center.clone().addScaledVector(r, a).addScaledVector(n, Dp / 2 + (o.off ?? 0.03));
    c.y = yc;
    const [hcol, hmr] = o.housing ?? (isNeon ? HOUSING_COLS[rnd.int(0, 1)] : rnd.pick(HOUSING_COLS));
    const fr = o.frame ?? 0.06;
    if (!o.noHousing) {
      this.hbox(c, [r, UP, n], [W / 2 + fr, Hh / 2 + fr, Dp / 2], hcol, hmr, new Set(['+z']));
      const fc = c.clone().addScaledVector(n, Dp / 2 + 0.012);
      this.hbox(fc.clone().addScaledVector(UP, Hh / 2 + fr / 2), [r, UP, n], [W / 2 + fr, fr / 2, 0.015], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(UP, -Hh / 2 - fr / 2), [r, UP, n], [W / 2 + fr, fr / 2, 0.015], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(r, W / 2 + fr / 2), [r, UP, n], [fr / 2, Hh / 2, 0.015], hcol, hmr);
      this.hbox(fc.clone().addScaledVector(r, -W / 2 - fr / 2), [r, UP, n], [fr / 2, Hh / 2, 0.015], hcol, hmr);
    }
    const tint = o.tint ?? (isNeon ? this.neonColor() : [1, 1, 1]);
    const seed = this.nextSeed();
    const ft = o.ftype ?? this.ftype(isNeon ? {} : { broken: 0, stutter: 0.05, breathe: 0 });
    const inten = o.inten ?? (design.mode === 0 ? rnd.range(5, 8) : design.mode === 4 ? rnd.range(4, 6) : design.mode === 3 ? 0.06 : rnd.range(1.6, 2.4));
    const back = o.back ?? (isNeon ? [hcol[0] * 0.6 + 0.008, hcol[1] * 0.6 + 0.008, hcol[2] * 0.6 + 0.01] : [0.02, 0.02, 0.02]);
    this.face(c.clone().addScaledVector(n, Dp / 2 + 0.003), r, UP, W / 2, Hh / 2, n, design, tint, inten, seed, ft, back);
    if (o.light !== false && design.mode !== 3) {
      const lp = c.clone().addScaledVector(n, 1.0 + Hh * 0.15);
      const lc = isNeon ? tint : (o.lightColor ?? [1, 0.9, 0.8]);
      this.light(lp, lc, (isNeon ? 5.5 : 4.5) * Math.sqrt(W * Hh) * (o.lightMul ?? 1), Math.min(20, 8 + W), seed, ft, o.importance ?? 1);
    }
    this.stats.signs++;
    return { c, W, Hh };
  }

  // Stack of small tenant boxes (zakkyo building directory) as a vertical blade.
  tenantStack(f, a, y0, count, o = {}) {
    const rnd = this.rnd, n = f.normal, r = f.right;
    const D = 0.95, cellH = D / 2, T = 0.3, gap = 0.3;
    const base = f.center.clone().addScaledVector(r, a);
    const Htot = count * (cellH + 0.04);
    base.y = y0 + Htot / 2;
    const c = base.clone().addScaledVector(n, gap + D / 2);
    const hcol = [0.55, 0.55, 0.56], hmr = [0.6, 0.4];
    this.hbox(c, [r, UP, n], [T / 2, Htot / 2 + 0.05, D / 2 + 0.05], hcol, hmr, new Set(['+x', '-x']));
    const seed0 = this.nextSeed();
    for (let i = 0; i < count; i++) {
      const d = rnd.pick(this.lib.tenant);
      const yc = y0 + (i + 0.5) * (cellH + 0.04);
      const cc = c.clone(); cc.y = yc;
      const seed = this.nextSeed();
      const ft = rnd() < 0.08 ? 1 : 0;
      const inten = rnd() < 0.12 ? 0.05 : rnd.range(1.5, 2.2); // some tenants closed (dark)
      this.face(cc.clone().addScaledVector(r, T / 2 + 0.003), n.clone().negate(), UP, D / 2 - 0.02, cellH / 2, r, d, [1, 1, 1], inten, seed, ft);
      this.face(cc.clone().addScaledVector(r, -T / 2 - 0.003), n.clone(), UP, D / 2 - 0.02, cellH / 2, r.clone().negate(), d, [1, 1, 1], inten, seed, ft);
      // divider
      this.hbox(cc.clone().addScaledVector(UP, cellH / 2 + 0.02), [r, UP, n], [T / 2 + 0.02, 0.02, D / 2 + 0.05], hcol, hmr);
    }
    const steel = [[0.18, 0.18, 0.19], [0.8, 0.45]];
    for (const yy of [Htot / 2 - 0.1, -Htot / 2 + 0.1]) {
      const p0 = base.clone().addScaledVector(UP, yy);
      this.bar(p0, p0.clone().addScaledVector(n, gap + 0.02), 0.03, ...steel);
    }
    const lp = c.clone().addScaledVector(n, 0.2); lp.y = y0 + Htot * 0.4;
    this.light(lp, [1, 0.92, 0.85], 10 * Math.sqrt(D * Htot), Math.min(18, 8 + Htot), seed0, 0);
    this.stats.signs++;
  }

  // Big rooftop letters on a steel frame at the top edge of the facade.
  rooftop(f, design, o = {}) {
    const rnd = this.rnd, n = f.normal, r = f.right;
    let W = Math.min(f.width * 0.85, o.width ?? rnd.range(8, 16));
    let Hh = W / design.aspect;
    const top = f.center.y + f.height / 2;
    const c = f.center.clone().addScaledVector(n, -0.6); c.y = top + 0.8 + Hh / 2;
    const steel = [[0.12, 0.12, 0.13], [0.8, 0.5]];
    // frame: posts + horizontal rails behind
    const nPosts = Math.max(2, Math.round(W / 3));
    for (let i = 0; i < nPosts; i++) {
      const x = -W / 2 + (i / (nPosts - 1)) * W;
      const p = c.clone().addScaledVector(r, x).addScaledVector(n, -0.25);
      this.bar(V(p.x, top, p.z), V(p.x, c.y + Hh / 2, p.z), 0.05, ...steel);
      this.bar(V(p.x, top, p.z), V(p.x, c.y, p.z).addScaledVector(n, -1.6), 0.035, ...steel);
    }
    for (const yy of [-Hh / 2, Hh / 2 - 0.05]) {
      const p = c.clone().addScaledVector(n, -0.25); p.y += yy;
      this.bar(p.clone().addScaledVector(r, -W / 2), p.clone().addScaledVector(r, W / 2), 0.04, ...steel);
    }
    const tint = o.tint ?? this.neonColor();
    const seed = this.nextSeed();
    const ft = o.ftype ?? (rnd() < 0.15 ? 2 : 0);
    const inten = o.inten ?? rnd.range(4, 6);
    // letters face both ways? rooftop letters face the street only
    this.F.quad(c, r, UP, W / 2, Hh / 2, n, design.rect.uv, { tint, sp: [design.mode + 6, inten, seed, ft], back: [0.01, 0.01, 0.012] });
    this.light(c.clone().addScaledVector(n, 1.5), tint, 14 * Math.sqrt(W * Hh), 20, seed, ft, 0.6);
    this.stats.signs++;
    return { c, W, Hh };
  }
}
