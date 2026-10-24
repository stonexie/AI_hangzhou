// Ground-floor shopfronts with real interior geometry (ramen, konbini, izakaya, pachinko, bar, boutique, lobby, shutters).
import { mulberry32 } from './rng.js';
import { DETAIL_ATTRS, FACADE_ATTRS, sideFrame, trimAttr } from './architecture.js';

// Shop atlas (4096x4096 canvas) slots in pixels: [x, y, w, h]
export const ATLAS_SIZE = 4096;
export const SLOTS = {
  ramen: [0, 0, 2048, 1024], konbini: [2048, 0, 2048, 1024],
  izakaya: [0, 1024, 2048, 1024], pachinko: [2048, 1024, 2048, 1024],
  shelves: [0, 2048, 2048, 1024], shutter: [2048, 2048, 1024, 1024],
  vending: [3072, 2048, 512, 1024], noren: [3584, 2048, 512, 256],
  posters: [0, 3072, 1024, 1024],
};
export const ATLAS_SOURCES = {
  ramen: 'shop_ramen', konbini: 'shop_konbini', izakaya: 'shop_izakaya', pachinko: 'shop_pachinko',
  shelves: 'shelves', shutter: 'shutter', vending: 'vending', noren: 'noren', posters: 'posters',
};

// uv for slot-relative (u,v) in [0,1], v up
export function slotUV(name, u, v, sub = null) {
  let [x, y, w, h] = SLOTS[name];
  if (sub) { x += sub[0] * w; y += sub[1] * h; w *= sub[2]; h *= sub[3]; }
  return [(x + u * w) / ATLAS_SIZE, 1 - (y + (1 - v) * h) / ATLAS_SIZE];
}

const WOOD = [0.32, 0.19, 0.1], WOOD_L = [0.55, 0.37, 0.2], DARK = [0.05, 0.05, 0.055], STEEL = [0.55, 0.56, 0.57];

const SHOP_WEIGHTS = {
  avenue: [['ramen', 2], ['konbini', 1.2], ['izakaya', 1.6], ['pachinko', 0.7], ['shutter', 0.6], ['bar', 1.1], ['boutique', 1.4], ['lobby', 0.7]],
  cross: [['ramen', 1.2], ['konbini', 0.6], ['izakaya', 1.5], ['shutter', 2.2], ['bar', 1.4], ['boutique', 0.8], ['lobby', 1.2]],
  alley: [['izakaya', 3], ['bar', 2.5], ['ramen', 1.4], ['shutter', 0.7]],
};
const LIGHT = {
  ramen: [1.0, 0.7, 0.42], konbini: [0.85, 0.93, 1.0], izakaya: [1.0, 0.62, 0.32], pachinko: [1.0, 0.85, 0.7],
  bar: [1.0, 0.6, 0.65], boutique: [1.0, 0.92, 0.82], lobby: [0.9, 0.95, 1.0],
};

export class ShopBuilder {
  constructor(B, out) { this.B = B; this.out = out; }

  // P(s, y, d): s along facade (right), y up from base, d inward (into building)
  frame(fr, baseY) {
    const o = fr.origin, r = fr.right, n = fr.normal;
    return (s, y, d) => [o[0] + r[0] * s - n[0] * d, baseY + y, o[2] + r[2] * s - n[2] * d];
  }

  build(lot, front, opts = {}) {
    const rng = mulberry32((lot.id * 104729 + front.side.charCodeAt(1) * 31) >>> 0);
    const v = lot.volumes[0];
    const fr = sideFrame(v, front.side, 0);
    const baseY = front.baseY > 0 ? front.baseY : 0;
    const W = fr.width;
    const H = lot.groundH;
    const lotDepth = (front.side === 'nx' || front.side === 'px') ? v.x1 - v.x0 : v.z1 - v.z0;
    const P = this.frame(fr, baseY);
    const cx = fr.origin[0] + fr.right[0] * W / 2, cz = fr.origin[2] + fr.right[2] * W / 2;
    const det = this.B.get(cx, cz, 'detail', DETAIL_ATTRS);
    const fac = this.B.get(cx, cz, 'facade', FACADE_ATTRS);
    const glass = this.B.get(cx, cz, 'glass', {});
    const type = opts.type || rng.weighted(SHOP_WEIGHTS[front.district] || SHOP_WEIGHTS.cross);
    const ctx = { rng, fr, P, W, H, det, fac, glass, lot, type, baseY, depth: Math.min(5.5, lotDepth - 0.6) };

    // structure: pillars + fascia (facade material so it matches the building)
    const ta = trimAttr(lot.wallLayer ?? 1, 3, 0.5, lot.seed);
    const pw = W > 7 ? 0.45 : 0.3;
    this.fbox(ctx, fac, pw / 2, H / 2, -0.04, pw, H, 0.3, ta);
    this.fbox(ctx, fac, W - pw / 2, H / 2, -0.04, pw, H, 0.3, ta);
    const fasH = rng.range(0.75, 1.0);
    const ho = H - fasH; // opening height
    ctx.ho = ho; ctx.s0 = pw; ctx.s1 = W - pw; ctx.fasH = fasH;
    // fascia: dark painted metal band (signage mounts on top of it)
    const fasCol = rng.pick([[0.08, 0.08, 0.09], [0.16, 0.05, 0.04], [0.85, 0.85, 0.82], [0.05, 0.07, 0.1], [0.3, 0.3, 0.3]]);
    this.dbox(ctx, W / 2, ho + fasH / 2, -0.12, W - 0.02, fasH, 0.26, fasCol, 0, 0.45, 0.3, 0.6);
    // fascia downlights strip
    for (let s = 0.8; s < W - 0.5; s += rng.range(1.4, 2.2)) this.dbox(ctx, s, ho - 0.01, -0.2, 0.1, 0.025, 0.1, [1, 0.8, 0.6], 1.6, 0.5, 0, 0);

    if (type === 'shutter') this.shutter(ctx);
    else {
      this.interiorShell(ctx);
      this[type](ctx);
      const lc = LIGHT[type];
      const pos = P(W / 2, ho - 0.35, 0.6);
      this.out.lights.push({ pos, color: lc, intensity: type === 'pachinko' || type === 'konbini' ? 9 : 6, distance: 9 });
    }
    // utility meter box / gas pipe on one pillar
    if (rng.chance(0.0)) {
      const ms = rng.chance(0.5) ? 0.2 : W - 0.2;
      this.dbox(ctx, ms, 1.5, -0.22, 0.28, 0.4, 0.12, [0.42, 0.42, 0.39], 0, 0.5, 0.2, 0.9);
      this.dbox(ctx, ms, 1.56, -0.285, 0.12, 0.06, 0.01, [0.5, 0.9, 0.6], 0.6, 0.3); // meter display
      this.dbox(ctx, ms, 0.65, -0.2, 0.04, 1.3, 0.04, [0.6, 0.55, 0.2], 0, 0.5, 0.4, 0.7); // gas riser
    }
    return type;
  }

  // ---------- primitives ----------
  dbox(c, s, y, d, sw, sh, sd, col, em, rough, metal = 0, grime = 0.4, tex = 0) {
    const p = c.P(s, y, d);
    const rotY = Math.atan2(c.fr.right[2], c.fr.right[0]) * -1;
    c.det.box(p[0], p[1], p[2], sw, sh, sd, { aCol: [col[0], col[1], col[2], em], aPbr: [rough, metal, tex, grime] }, rotY);
  }
  fbox(c, bucket, s, y, d, sw, sh, sd, a) {
    const p = c.P(s, y, d);
    const rotY = -Math.atan2(c.fr.right[2], c.fr.right[0]);
    bucket.box(p[0], p[1], p[2], sw, sh, sd, a, rotY);
  }
  // textured quad facing outward (toward the street), spanning s0..s1, y0..y1 at depth d
  tquad(c, s0, s1, y0, y1, d, slot, col, em, sub = null, rough = 0.6, flipFacing = false) {
    const p0 = c.P(s0, y0, d), p1 = c.P(s1, y0, d), p2 = c.P(s1, y1, d), p3 = c.P(s0, y1, d);
    const a = { aCol: [col[0], col[1], col[2], em], aPbr: [rough, 0, 1, 0] };
    const u = (uu, vv) => slotUV(slot, uu, vv, sub);
    if (!flipFacing) c.det.quad(p0, p1, p2, p3, u(0, 0), u(1, 0), u(1, 1), u(0, 1), a);
    else c.det.quad(p1, p0, p3, p2, u(1, 0), u(0, 0), u(0, 1), u(1, 1), a);
  }
  // plain colored quad facing a given direction; pts in local (s,y,d)
  lquad(c, pts, col, em, rough = 0.7, metal = 0) {
    const w = pts.map((q) => c.P(q[0], q[1], q[2]));
    const a = { aCol: [col[0], col[1], col[2], em], aPbr: [rough, metal, 0, 0.2] };
    c.det.quad(w[0], w[1], w[2], w[3], [0, 0], [1, 0], [1, 1], [0, 1], a);
  }

  // Real-world-scale textured wall: splits A->B into tiles, each mapping a random square-ish crop of the slot.
  tileWall(c, A, Bp, y0, y1, slot, tint, em) {
    const len = Math.hypot(Bp[0] - A[0], Bp[1] - A[1]);
    const th = y1 - y0;
    const [, , sw, sh] = SLOTS[slot];
    const n = Math.max(1, Math.round(len / th));
    const tw = len / n;
    const cw = Math.min(1, (tw / th) * (sh / sw)); // crop width in slot units keeping texel aspect
    for (let i = 0; i < n; i++) {
      const t0 = i / n, t1 = (i + 1) / n;
      const sA = A[0] + (Bp[0] - A[0]) * t0, dA = A[1] + (Bp[1] - A[1]) * t0;
      const sB = A[0] + (Bp[0] - A[0]) * t1, dB = A[1] + (Bp[1] - A[1]) * t1;
      const u0 = c.rng.range(0, 1 - cw);
      const uv = (uu, vv) => slotUV(slot, u0 + uu * cw, vv);
      const p0 = c.P(sA, y0, dA), p1 = c.P(sB, y0, dB), p2 = c.P(sB, y1, dB), p3 = c.P(sA, y1, dA);
      c.det.quad(p0, p1, p2, p3, uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1), { aCol: [tint[0], tint[1], tint[2], em], aPbr: [0.6, 0, 1, 0] });
    }
  }

  interiorShell(c) {
    const { s0, s1, ho, depth: D, type } = c;
    const lc = LIGHT[type] || [1, 0.9, 0.8];
    const wallCol = { ramen: [0.55, 0.4, 0.26], konbini: [0.92, 0.93, 0.95], izakaya: [0.35, 0.22, 0.12], pachinko: [0.9, 0.75, 0.5], bar: [0.16, 0.1, 0.07], boutique: [0.92, 0.9, 0.86], lobby: [0.8, 0.8, 0.78] }[type];
    const wallEm = { ramen: 0.35, konbini: 0.7, izakaya: 0.3, pachinko: 0.8, bar: 0.2, boutique: 0.6, lobby: 0.45 }[type];
    const floorCol = { ramen: [0.25, 0.16, 0.1], konbini: [0.75, 0.75, 0.73], izakaya: [0.2, 0.13, 0.08], pachinko: [0.5, 0.12, 0.1], bar: [0.1, 0.08, 0.08], boutique: [0.55, 0.45, 0.35], lobby: [0.4, 0.4, 0.42] }[type];
    const ceilH = ho + 0.25;
    const em = (k) => [wallCol[0] * lc[0], wallCol[1] * lc[1], wallCol[2] * lc[2]];
    // floor (faces up)
    c.det.quad(c.P(s0, 0.02, 0), c.P(s1, 0.02, 0), c.P(s1, 0.02, D), c.P(s0, 0.02, D), [0, 0], [1, 0], [1, 1], [0, 1],
      { aCol: [...floorCol, wallEm * 0.4], aPbr: [0.25, 0, 0, 0.2] }, [0, 1, 0]);
    // ceiling (faces down)
    c.det.quad(c.P(s0, ceilH, 0), c.P(s0, ceilH, D), c.P(s1, ceilH, D), c.P(s1, ceilH, 0), [0, 0], [1, 0], [1, 1], [0, 1],
      { aCol: [...em(), wallEm * 0.6], aPbr: [0.8, 0, 0, 0] }, [0, -1, 0]);
    // side walls (face inward)
    const sideSlot = { ramen: 'izakaya', konbini: 'shelves', izakaya: 'izakaya', pachinko: 'pachinko', bar: 'izakaya', boutique: 'shelves', lobby: null }[type];
    if (sideSlot) {
      // textured side walls (menus / shelves / machines) instead of flat colour
      const k = type === 'bar' ? [0.6, 0.45, 0.5] : type === 'ramen' ? [0.95, 0.8, 0.65] : [0.9, 0.9, 0.9];
      const a = { aCol: [k[0], k[1], k[2], type === 'pachinko' ? 1.1 : 0.55], aPbr: [0.6, 0, 1, 0] };
      const y0 = (type === 'konbini' || type === 'boutique' || type === 'pachinko') ? 0 : 0.9;
      this.tileWall(c, [s0, 0.15], [s0, D], y0, ceilH, sideSlot, k, a.aCol[3]);
      this.tileWall(c, [s1, D], [s1, 0.15], y0, ceilH, sideSlot, k, a.aCol[3]);
      if (y0 > 0) {
        this.lquad(c, [[s0, 0, 0], [s0, 0, D], [s0, y0, D], [s0, y0, 0]], [0.18, 0.11, 0.06], 0.12, 0.6);
        this.lquad(c, [[s1, 0, D], [s1, 0, 0], [s1, y0, 0], [s1, y0, D]], [0.18, 0.11, 0.06], 0.12, 0.6);
      }
    } else {
      this.lquad(c, [[s0, 0, D], [s0, 0, 0], [s0, ceilH, 0], [s0, ceilH, D]].reverse(), em(), wallEm);
      this.lquad(c, [[s1, 0, 0], [s1, 0, D], [s1, ceilH, D], [s1, ceilH, 0]].reverse(), em(), wallEm);
    }
    // back wall textured
    const slot = { ramen: 'ramen', konbini: 'konbini', izakaya: 'izakaya', pachinko: 'pachinko', bar: 'izakaya', boutique: 'shelves', lobby: null }[type];
    if (slot) {
      const tc = type === 'bar' ? [0.9, 0.6, 0.75] : [1, 1, 1];
      const y0 = (type === 'konbini' || type === 'boutique' || type === 'pachinko') ? 0 : 0.9;
      this.tileWall(c, [s0, D], [s1, D], y0, ceilH, slot, tc, type === 'pachinko' ? 1.4 : 0.95);
      if (y0 > 0) this.lquad(c, [[s0, 0, D], [s1, 0, D], [s1, y0, D], [s0, y0, D]], [0.2, 0.12, 0.07], 0.15, 0.6);
    } else this.lquad(c, [[s0, 0, D], [s1, 0, D], [s1, ceilH, D], [s0, ceilH, D]], em(), wallEm);
    // glass front with mullions, door, kick plate
    if (type !== 'izakaya') this.glassFront(c);
  }

  glassFront(c) {
    const { s0, s1, ho, rng } = c;
    const g = c.glass;
    const d = 0.06;
    g.quad(c.P(s0, 0, d), c.P(s1, 0, d), c.P(s1, ho, d), c.P(s0, ho, d), [0, 0], [1, 0], [1, 1], [0, 1], {});
    const fcol = rng.chance(0.6) ? DARK : STEEL;
    const n = Math.max(2, Math.round((s1 - s0) / 1.6));
    for (let i = 0; i <= n; i++) {
      const s = s0 + (s1 - s0) * i / n;
      this.dbox(c, s, ho / 2, d, 0.06, ho, 0.08, fcol, 0, 0.35, 0.7, 0.1);
    }
    this.dbox(c, (s0 + s1) / 2, 0.15, d, s1 - s0, 0.3, 0.1, fcol, 0, 0.4, 0.6, 0.3);
    this.dbox(c, (s0 + s1) / 2, ho - 0.03, d, s1 - s0, 0.06, 0.1, fcol, 0, 0.4, 0.6, 0.1);
    // transom bar
    this.dbox(c, (s0 + s1) / 2, ho - 0.55, d, s1 - s0, 0.05, 0.08, fcol, 0, 0.4, 0.6, 0.1);
  }

  noren(c, s, w, top) {
    // 4 panels with gaps
    const pn = 4, gap = 0.03, pw = (w - gap * (pn - 1)) / pn;
    for (let i = 0; i < pn; i++) {
      const a = s + i * (pw + gap);
      const u0 = [0.012, 0.256, 0.502, 0.748][i], u1 = u0 + 0.24;
      const sub = [u0, 0.075, u1 - u0, 0.84];
      const sway = (i % 2 ? 0.02 : -0.015);
      const p0 = c.P(a, top - 0.85, -0.12 - sway), p1 = c.P(a + pw, top - 0.85, -0.12 - sway), p2 = c.P(a + pw, top, -0.1), p3 = c.P(a, top, -0.1);
      const at = { aCol: [1, 1, 1, 0.06], aPbr: [0.9, 0, 1, 0] };
      const uv = (uu, vv) => slotUV('noren', uu, vv, sub);
      c.det.quad(p0, p1, p2, p3, uv(0, 0), uv(1, 0), uv(1, 1), uv(0, 1), at);
      c.det.quad(p1, p0, p3, p2, uv(1, 0), uv(0, 0), uv(0, 1), uv(1, 1), at);
    }
    this.dbox(c, s + w / 2, top + 0.02, -0.1, w + 0.2, 0.03, 0.03, WOOD, 0, 0.5);
  }

  awning(c, col, stripes = false) {
    const { W, ho, rng } = c;
    const proj = rng.range(0.9, 1.5), drop = rng.range(0.35, 0.6);
    const yTop = ho + 0.12;
    const n = stripes ? Math.max(4, Math.round(W / 0.5)) : 1;
    for (let i = 0; i < n; i++) {
      const s0 = 0.1 + (W - 0.2) * i / n, s1 = 0.1 + (W - 0.2) * (i + 1) / n;
      const cc = stripes && i % 2 ? [0.85, 0.83, 0.78] : col;
      const a = { aCol: [cc[0], cc[1], cc[2], 0.02], aPbr: [0.55, 0, 0, 0.6] };
      const p0 = c.P(s0, yTop - drop, -proj), p1 = c.P(s1, yTop - drop, -proj), p2 = c.P(s1, yTop, -0.25), p3 = c.P(s0, yTop, -0.25);
      c.det.quad(p0, p1, p2, p3, [0, 0], [1, 0], [1, 1], [0, 1], a);
      c.det.quad(p1, p0, p3, p2, [0, 0], [1, 0], [1, 1], [0, 1], { aCol: [cc[0] * 0.5, cc[1] * 0.5, cc[2] * 0.5, 0.05], aPbr: [0.8, 0, 0, 0.3] });
      // valance
      const v0 = c.P(s0, yTop - drop - 0.22, -proj), v1 = c.P(s1, yTop - drop - 0.22, -proj), v2 = c.P(s1, yTop - drop, -proj), v3 = c.P(s0, yTop - drop, -proj);
      c.det.quad(v0, v1, v2, v3, [0, 0], [1, 0], [1, 1], [0, 1], a);
    }
    // frame arms
    for (const s of [0.15, W - 0.15]) {
      const p0 = c.P(s, yTop - drop, -proj), p1 = c.P(s, yTop - 0.05, -0.2);
      c.det.beam(p0, p1, 0.025, { aCol: [...DARK, 0], aPbr: [0.4, 0.7, 0, 0.3] });
    }
  }

  // ---------- types ----------
  ramen(c) {
    const { s0, s1, ho, depth: D, rng } = c;
    const cd = Math.min(D * 0.45, 2.0);
    // counter
    this.dbox(c, (s0 + s1) / 2, 0.5, cd + 0.3, s1 - s0 - 0.6, 1.0, 0.6, WOOD, 0.12, 0.5);
    this.dbox(c, (s0 + s1) / 2, 1.03, cd + 0.25, s1 - s0 - 0.5, 0.06, 0.75, WOOD_L, 0.15, 0.25);
    // bowls / condiments on counter
    for (let s = s0 + 0.6; s < s1 - 0.6; s += 0.65) {
      this.dbox(c, s + rng.range(-0.1, 0.1), 1.1, cd + 0.12, 0.16, 0.08, 0.16, [0.9, 0.88, 0.8], 0.25, 0.3);
      if (rng.chance(0.5)) this.dbox(c, s + 0.25, 1.12, cd + 0.4, 0.06, 0.13, 0.06, [0.5, 0.1, 0.05], 0.1, 0.3);
    }
    // stools
    for (let s = s0 + 0.55; s < s1 - 0.4; s += 0.62) {
      this.dbox(c, s, 0.36, cd - 0.25, 0.05, 0.7, 0.05, STEEL, 0.05, 0.4, 0.8, 0.1);
      this.dbox(c, s, 0.72, cd - 0.25, 0.34, 0.07, 0.34, [0.6, 0.06, 0.04], 0.12, 0.45);
    }
    // pendant lamps
    for (let s = s0 + 0.8; s < s1 - 0.5; s += 1.25) {
      this.dbox(c, s, ho - 0.2, cd + 0.3, 0.01, 0.5, 0.01, DARK, 0, 0.5);
      this.dbox(c, s, ho - 0.5, cd + 0.3, 0.28, 0.16, 0.28, [1, 0.72, 0.4], 3.5, 0.5);
    }
    // menu strips above back
    for (let s = s0 + 0.3; s < s1 - 0.3; s += 0.16) this.dbox(c, s, ho - 0.15, D - 0.2, 0.12, 0.35, 0.01, [0.95, 0.9, 0.75], 0.5, 0.8);
    this.noren(c, s0 + (s1 - s0) * rng.range(0.1, 0.45), Math.min(1.6, (s1 - s0) * 0.45), ho - 0.05);
    if (rng.chance(0.7)) this.awning(c, rng.pick([[0.55, 0.06, 0.05], [0.1, 0.12, 0.2], [0.12, 0.2, 0.1]]), rng.chance(0.3));
  }

  konbini(c) {
    const { s0, s1, ho, depth: D, rng } = c;
    for (let d = 0.6; d < D - 0.3; d += 1.0) this.dbox(c, (s0 + s1) / 2, ho + 0.2, d, s1 - s0 - 0.4, 0.04, 0.2, [0.95, 0.98, 1.0], 5.0, 0.5);
    const rows = D > 4 ? [1.8, 3.2] : [2.0];
    for (const d of rows) {
      this.dbox(c, (s0 + s1) / 2, 0.75, d, (s1 - s0) * 0.7, 1.5, 0.6, [0.9, 0.9, 0.9], 0.4, 0.5);
      this.tquad(c, s0 + (s1 - s0) * 0.15, s1 - (s1 - s0) * 0.15, 0.02, 1.5, d - 0.31, 'shelves', [1, 1, 1], 0.9, [rng.range(0, 0.5), 0, 0.5, 1]);
    }
    // magazine rack along the window
    this.dbox(c, (s0 + s1) / 2, 0.45, 0.35, s1 - s0 - 0.6, 0.9, 0.3, [0.85, 0.85, 0.85], 0.4, 0.5);
    this.tquad(c, s0 + 0.3, s1 - 0.3, 0.5, 0.9, 0.19, 'shelves', [1, 1, 1], 0.8, [rng.range(0, 0.5), 0.6, 0.5, 0.4]);
    // checkout
    this.dbox(c, s1 - 0.8, 0.5, D * 0.5, 0.8, 1.0, 1.6, [0.85, 0.85, 0.85], 0.35, 0.4);
    // green/orange brand stripe on fascia
    const stripe = rng.pick([[0.05, 0.55, 0.25], [0.95, 0.45, 0.05], [0.1, 0.3, 0.75]]);
    this.dbox(c, c.W / 2, c.ho + 0.25, -0.27, c.W - 0.1, 0.18, 0.03, stripe, 1.2, 0.4);
    this.dbox(c, c.W / 2, c.ho + 0.55, -0.27, c.W - 0.1, 0.12, 0.03, [0.9, 0.9, 0.9], 1.0, 0.4);
  }

  izakaya(c) {
    const { s0, s1, ho, depth: D, rng } = c;
    // wooden lattice (koshi) front with glowing paper behind, door with noren
    const doorW = Math.min(1.5, (s1 - s0) * 0.35);
    const doorS = s0 + (s1 - s0 - doorW) * rng.range(0.2, 0.8);
    const paperCol = [1.0, 0.72, 0.42];
    const segs = [[s0, doorS], [doorS + doorW, s1]];
    for (const [a, b] of segs) {
      if (b - a < 0.2) continue;
      this.lquad(c, [[a, 0.3, 0.12], [b, 0.3, 0.12], [b, ho, 0.12], [a, ho, 0.12]], paperCol, 1.4, 0.9);
      for (let s = a + 0.04; s < b; s += 0.09) this.dbox(c, s, (ho + 0.3) / 2, 0.06, 0.035, ho - 0.3, 0.05, WOOD, 0.02, 0.6, 0, 0.3);
      for (const y of [0.9, ho - 0.6]) this.dbox(c, (a + b) / 2, y, 0.04, b - a, 0.05, 0.06, WOOD, 0, 0.6);
      this.dbox(c, (a + b) / 2, 0.15, 0.06, b - a, 0.3, 0.1, [0.15, 0.1, 0.07], 0, 0.7, 0, 0.7);
    }
    // door opening glass + interior visible
    const g = c.glass;
    g.quad(c.P(doorS, 0, 0.08), c.P(doorS + doorW, 0, 0.08), c.P(doorS + doorW, ho, 0.08), c.P(doorS, ho, 0.08), [0, 0], [1, 0], [1, 1], [0, 1], {});
    this.dbox(c, doorS, ho / 2, 0.06, 0.08, ho, 0.1, WOOD, 0, 0.6);
    this.dbox(c, doorS + doorW, ho / 2, 0.06, 0.08, ho, 0.1, WOOD, 0, 0.6);
    // counter inside
    this.dbox(c, (s0 + s1) / 2, 0.55, D * 0.55, s1 - s0 - 0.4, 1.1, 0.5, WOOD, 0.15, 0.5);
    for (let s = s0 + 0.5; s < s1 - 0.4; s += 0.7) this.dbox(c, s, 0.7, D * 0.55 - 0.5, 0.3, 0.06, 0.3, WOOD_L, 0.1, 0.5);
    this.noren(c, doorS - 0.1, doorW + 0.2, ho - 0.02);
    if (rng.chance(0.5)) this.awning(c, [0.12, 0.1, 0.09]);
  }

  pachinko(c) {
    const { s0, s1, ho, depth: D } = c;
    for (let d = 0.5; d < D; d += 0.9) this.dbox(c, (s0 + s1) / 2, ho + 0.2, d, s1 - s0 - 0.3, 0.05, 0.3, [1, 0.95, 0.85], 6, 0.5);
    // machine bank facing street
    const md = Math.min(2.4, D - 1);
    this.dbox(c, (s0 + s1) / 2, 0.95, md + 0.3, s1 - s0 - 0.5, 1.9, 0.6, [0.7, 0.6, 0.3], 0.3, 0.3, 0.6);
    this.tquad(c, s0 + 0.25, s1 - 0.25, 0.1, 1.9, md - 0.01, 'pachinko', [1, 1, 1], 1.5, [0, 0.1, 1, 0.8]);
    // stools
    for (let s = s0 + 0.5; s < s1 - 0.4; s += 0.55) this.dbox(c, s, 0.4, md - 0.45, 0.3, 0.08, 0.3, [0.7, 0.1, 0.1], 0.2, 0.4);
    // gold fascia accent
    this.dbox(c, c.W / 2, c.ho + 0.1, -0.27, c.W - 0.1, 0.08, 0.04, [1.0, 0.75, 0.3], 3, 0.3, 0.8);
  }

  bar(c) {
    const { s0, s1, ho, depth: D, rng } = c;
    const neon = rng.pick([[1, 0.15, 0.6], [0.2, 0.7, 1], [0.7, 0.2, 1]]);
    this.dbox(c, (s0 + s1) / 2, ho + 0.15, D - 0.3, s1 - s0 - 0.3, 0.04, 0.04, neon, 8, 0.4);
    this.dbox(c, (s0 + s1) / 2, 0.55, D * 0.5, s1 - s0 - 0.6, 1.1, 0.5, [0.12, 0.08, 0.06], 0.1, 0.3);
    this.dbox(c, (s0 + s1) / 2, 1.12, D * 0.5, s1 - s0 - 0.5, 0.04, 0.6, [0.4, 0.3, 0.25], 0.2, 0.15, 0.3);
    for (let s = s0 + 0.5; s < s1 - 0.4; s += 0.6) {
      this.dbox(c, s, 0.4, D * 0.5 - 0.5, 0.04, 0.8, 0.04, STEEL, 0.05, 0.3, 0.9);
      this.dbox(c, s, 0.8, D * 0.5 - 0.5, 0.32, 0.06, 0.32, [0.1, 0.05, 0.05], 0.1, 0.4);
    }
    // frosted / tinted glass: add a translucent dark film on lower half
    // bottle shelf glow strip behind the bar
    this.dbox(c, (s0 + s1) / 2, 1.6, D - 0.25, s1 - s0 - 0.4, 0.03, 0.3, neon, 2.5, 0.4);
  }

  boutique(c) {
    const { s0, s1, ho, depth: D, rng } = c;
    for (let d = 0.6; d < D - 0.3; d += 1.2) this.dbox(c, (s0 + s1) / 2, ho + 0.2, d, s1 - s0 - 0.6, 0.04, 0.16, [1, 0.95, 0.88], 4, 0.5);
    // clothing racks / display tables
    for (let i = 0; i < 3; i++) {
      const s = s0 + (s1 - s0) * (0.2 + 0.3 * i), d = rng.range(1.2, D - 1.0);
      this.dbox(c, s, 0.45, d, 1.0, 0.9, 0.6, [0.85, 0.82, 0.78], 0.35, 0.5);
      this.dbox(c, s, 0.95, d, 0.8, 0.12, 0.4, rng.pick([[0.6, 0.2, 0.2], [0.2, 0.3, 0.5], [0.9, 0.85, 0.7]]), 0.3, 0.8);
    }
    // mannequin-ish columns at window
    for (const s of [s0 + 0.6, s1 - 0.6]) this.dbox(c, s, 0.9, 0.6, 0.35, 1.7, 0.25, rng.pick([[0.85, 0.85, 0.85], [0.15, 0.15, 0.15]]), 0.25, 0.6);
    if (rng.chance(0.5)) this.awning(c, rng.pick([[0.2, 0.2, 0.22], [0.5, 0.1, 0.1]]), true);
  }

  lobby(c) {
    const { s0, s1, ho, depth: D } = c;
    this.dbox(c, (s0 + s1) / 2, ho + 0.2, D * 0.5, 1.2, 0.04, 1.2, [0.95, 0.97, 1], 5, 0.5);
    // mailboxes on a side wall
    this.dbox(c, s0 + 0.15, 1.3, D * 0.6, 0.2, 1.2, 1.6, [0.6, 0.6, 0.62], 0.3, 0.4, 0.6);
    // stair / elevator door at back
    this.dbox(c, (s0 + s1) / 2, 1.1, D - 0.05, 1.0, 2.2, 0.05, [0.7, 0.7, 0.72], 0.3, 0.3, 0.8);
  }

  shutter(c) {
    const { s0, s1, ho, rng, W } = c;
    const sub = [rng.range(0, 0.4), 0, 0.6, 1];
    const open = rng.chance(0.2) ? rng.range(0.25, 0.5) : 0;
    this.tquad(c, s0, s1, open, ho, 0.12, 'shutter', [0.85, 0.85, 0.85], 0.0, sub, 0.5);
    // shutter box & guide rails
    this.dbox(c, W / 2, ho + 0.15, -0.0, s1 - s0, 0.3, 0.3, [0.45, 0.45, 0.43], 0, 0.5, 0.4, 0.8);
    this.dbox(c, s0 + 0.02, ho / 2, 0.08, 0.05, ho, 0.08, [0.35, 0.35, 0.34], 0, 0.5, 0.6, 0.6);
    this.dbox(c, s1 - 0.02, ho / 2, 0.08, 0.05, ho, 0.08, [0.35, 0.35, 0.34], 0, 0.5, 0.6, 0.6);
    if (open > 0) {
      // light leaking under a half-open shutter
      this.lquad(c, [[s0, 0.0, 0.5], [s1, 0.0, 0.5], [s1, open, 0.5], [s0, open, 0.5]], [1, 0.85, 0.6], 1.5, 0.8);
    }
    // back of the opening (dark) so nothing shows through gaps
    this.lquad(c, [[s0, 0, 0.6], [s1, 0, 0.6], [s1, ho, 0.6], [s0, ho, 0.6]], [0.02, 0.02, 0.02], 0);
  }
}
