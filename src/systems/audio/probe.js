// Defensive probing of other systems' APIs. Every function tolerates missing / partially-built APIs and
// falls back to positions derived from the shared LAYOUT so the soundscape works even with stub systems.
import { mulberry32 } from './dsp.js';

// Extract a world position {x,y,z} from anything vaguely positional. Returns null if impossible.
const _m = { x: 0, y: 0, z: 0 };
export function posOf(o, out = { x: 0, y: 0, z: 0 }) {
  if (!o) return null;
  try {
    if (o.isObject3D) {
      const e = o.matrixWorld?.elements;
      // matrixWorld may be stale/identity before the first render → fall back to local position
      if (e && (e[12] || e[13] || e[14])) { out.x = e[12]; out.y = e[13]; out.z = e[14]; return out; }
      return posOf(o.position, out);
    }
    if (o.isVector3 || (typeof o.x === 'number' && typeof o.z === 'number')) { out.x = o.x; out.y = o.y ?? 0; out.z = o.z; return out; }
    if (Array.isArray(o) && o.length >= 3 && typeof o[0] === 'number') { out.x = o[0]; out.y = o[1]; out.z = o[2]; return out; }
    if (o.position) return posOf(o.position, out);
    if (o.pos) return posOf(o.pos, out);
    if (o.center) return posOf(o.center, out);
    if (o.object) return posOf(o.object, out);
    if (o.mesh) return posOf(o.mesh, out);
    if (o.group) return posOf(o.group, out);
  } catch { /* ignore */ }
  return null;
}
void _m;

// Uniform 2D (XZ) hash grid for static candidate points / facades → O(nearby) queries instead of O(all).
export class Grid {
  constructor(cell = 32) { this.cell = cell; this.map = new Map(); }
  key(ix, iz) { return ix * 73856093 ^ iz * 19349663; }
  insert(item, x, z, r = 0) {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const k = this.key(ix, iz);
      let b = this.map.get(k); if (!b) { b = []; this.map.set(k, b); }
      b.push(item);
    }
  }
  // items in cells overlapping the query circle (may contain duplicates for multi-cell items)
  query(x, z, r, out = []) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) {
      const b = this.map.get(this.key(ix, iz));
      if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
    }
    return out;
  }
  static of(points) { const g = new Grid(); for (const p of points) g.insert(p, p.x, p.z); return g; }
  static ofFacades(facades) {
    const g = new Grid();
    for (const f of facades) if (f.center) g.insert(f, f.center.x, f.center.z, (f.width || 10) / 2 + 1);
    return g;
  }
}

export function firstArray(obj, keys) {
  if (!obj) return null;
  for (const k of keys) {
    try {
      const v = typeof obj[k] === 'function' ? null : obj[k];
      if (Array.isArray(v) && v.length) return v;
    } catch { /* getter threw */ }
  }
  return null;
}

// Layout-derived pseudo facades (same shape as ctx.api.buildings.facades) used when buildings are absent.
export function layoutFacades(L) {
  const out = [];
  try {
    const av = L.avenue, bl = L.blocks, cs = L.crossStreets;
    const fx = av.roadHalfWidth + av.sidewalkWidth + 1; // ≈ 11
    const gaps = cs.zs.map((z) => [z - cs.roadHalfWidth - cs.sidewalkWidth, z + cs.roadHalfWidth + cs.sidewalkWidth]);
    const rng = mulberry32(77);
    for (const side of [-1, 1]) {
      for (let z = av.zStart; z > av.zEnd; ) {
        const w = 12 + rng() * 14;
        const zc = z - w / 2;
        if (!gaps.some(([a, b]) => zc > a && zc < b) && !(Math.abs(zc - L.alley.z) < L.alley.width / 2 + 1 && side < 0)) {
          out.push({ center: { x: side * fx, y: 10, z: zc }, normal: { x: -side, y: 0, z: 0 }, right: { x: 0, y: 0, z: side }, width: w, height: bl.minHeight + rng() * 30, district: 'avenue', shopfront: rng() < 0.7 });
        }
        z -= w;
      }
    }
    const al = L.alley;
    for (const side of [-1, 1]) {
      for (let x = al.xStart; x > al.xEnd; x -= 10) {
        out.push({ center: { x: x - 5, y: 6, z: al.z + side * al.width / 2 }, normal: { x: 0, y: 0, z: -side }, right: { x: 1, y: 0, z: 0 }, width: 10, height: 12, district: 'alley', shopfront: rng() < 0.5 });
      }
    }
  } catch { /* layout missing */ }
  return out;
}

export function getFacades(ctx, fallback) {
  const f = ctx.api?.buildings?.facades;
  return Array.isArray(f) && f.length ? f : fallback;
}

// Nearest point on facades (horizontal) to p; returns {d, x, y, z} or null. Facades behind the listener's
// side (listener inside the block) are skipped.
export function nearestFacadePoint(facades, p, maxD = 40) {
  let best = null, bd = maxD;
  for (let i = 0; i < facades.length; i++) {
    const f = facades[i];
    const c = f.center, n = f.normal, r = f.right;
    if (!c || !n || !r) continue;
    const dx = p.x - c.x, dz = p.z - c.z;
    const hw = (f.width || 10) / 2;
    if (Math.abs(dx) > bd + hw || Math.abs(dz) > bd + hw) continue;
    const nd = dx * n.x + dz * n.z;
    if (nd < -0.5) continue;
    if (p.y > (f.height || 20) + (c.y - (f.height || 20) / 2) + 3) continue; // above the roof
    const along = dx * r.x + dz * r.z;
    const ca = Math.max(-hw, Math.min(hw, along));
    const ex = along - ca;
    const d = Math.sqrt(nd * nd + ex * ex);
    if (d < bd) { bd = d; best = { d, x: c.x + r.x * ca + n.x * 0.8, y: 3.4, z: c.z + r.z * ca + n.z * 0.8, f }; }
  }
  return best;
}

// Neon sign emitter candidates: signage API → shopfront facades → layout facades.
export function neonCandidates(ctx, facades) {
  const out = [];
  const sg = ctx.api?.signage;
  // signage exposes { lights: LightPool{ cands: [{ pos: Vector3, ... }] } }
  const arr = firstArray(sg, ['signs', 'neons', 'emitters', 'items', 'lights', 'positions']) || firstArray(sg?.lights, ['cands', 'candidates']);
  if (arr) {
    for (let i = 0; i < arr.length && out.length < 4000; i++) {
      const p = posOf(arr[i]);
      if (p) out.push({ x: p.x, y: p.y, z: p.z, key: 's' + i });
    }
    if (out.length) return out;
  }
  const rng = mulberry32(91);
  for (let i = 0; i < facades.length; i++) {
    const f = facades[i];
    if (!f.center || !f.normal || !f.right) continue;
    if (!(f.shopfront || rng() < 0.35)) continue;
    const off = ((rng() - 0.5) * (f.width || 10)) * 0.6;
    const y = 3.5 + rng() * 4;
    out.push({ x: f.center.x + f.right.x * off + f.normal.x * 0.6, y, z: f.center.z + f.right.z * off + f.normal.z * 0.6, key: 'f' + i });
  }
  return out;
}

// Gutter / downpipe points at facade edges
export function gutterCandidates(facades) {
  const out = [];
  for (let i = 0; i < facades.length; i++) {
    const f = facades[i];
    if (!f.center || !f.normal || !f.right) continue;
    if (i % 2) continue;
    const hw = (f.width || 10) / 2 - 0.4;
    out.push({ x: f.center.x + f.right.x * hw + f.normal.x * 0.3, y: 0.3, z: f.center.z + f.right.z * hw + f.normal.z * 0.3, key: 'g' + i });
  }
  return out;
}

// Shop / ramen chatter emitters: explicit API → shopfront facades
export function shopCandidates(ctx, facades) {
  const out = [];
  const explicit = [ctx.api?.signage?.ramen, ctx.api?.buildings?.ramenShop, ctx.api?.buildings?.ramen].filter(Boolean);
  for (const e of explicit) { const p = posOf(e); if (p) out.push({ x: p.x, y: 1.5, z: p.z, key: 'r' + out.length }); }
  const shops = firstArray(ctx.api?.buildings, ['shops', 'shopfronts', 'interiors']);
  if (shops) for (let i = 0; i < shops.length; i++) { const p = posOf(shops[i]); if (p) out.push({ x: p.x, y: 1.5, z: p.z, key: 'b' + i }); }
  if (out.length) return out;
  for (let i = 0; i < facades.length; i++) {
    const f = facades[i];
    if (!f.shopfront || !f.center || !f.normal) continue;
    if (i % 3) continue; // not every shop is busy
    out.push({ x: f.center.x + f.normal.x * 0.4, y: 1.5, z: f.center.z + f.normal.z * 0.4, key: 'h' + i });
  }
  return out;
}

// Vending machines: API → deterministic layout placement on sidewalks + alley
export function vendingCandidates(ctx, L) {
  const out = [];
  const arr = firstArray(ctx.api?.signage, ['vendingMachines', 'vending']) || firstArray(ctx.api?.buildings, ['vendingMachines', 'vending', 'props']);
  if (arr) for (let i = 0; i < arr.length; i++) { const p = posOf(arr[i]); if (p) out.push({ x: p.x, y: 1, z: p.z, key: 'v' + i }); }
  if (out.length) return out;
  try {
    const rng = mulberry32(55);
    const fx = L.avenue.roadHalfWidth + L.avenue.sidewalkWidth - 0.6;
    for (let z = L.avenue.zStart - 15; z > L.avenue.zEnd; z -= 35 + rng() * 30) out.push({ x: (rng() < 0.5 ? -1 : 1) * fx, y: 1, z, key: 'v' + out.length });
    for (let x = L.alley.xStart - 8; x > L.alley.xEnd; x -= 18 + rng() * 10) out.push({ x, y: 1, z: L.alley.z + (rng() < 0.5 ? -1 : 1) * (L.alley.width / 2 - 0.5), key: 'v' + out.length });
  } catch { /* ignore */ }
  return out;
}

// Pedestrian positions from the crowd API (any of several plausible shapes)
export function crowdPositions(ctx) {
  const c = ctx.api?.crowd;
  if (!c) return null;
  try {
    if (typeof c.positions === 'function') { const r = c.positions(); if (Array.isArray(r) || ArrayBuffer.isView(r)) return r; }
    const arr = firstArray(c, ['pedestrians', 'agents', 'people', 'peds', 'characters', 'positions']);
    if (arr) return arr;
    if (ArrayBuffer.isView(c.positions)) return c.positions;
  } catch { /* ignore */ }
  return null;
}

// Moving traffic cars from vehicles API
export function trafficCars(ctx) {
  const v = ctx.api?.vehicles;
  return firstArray(v, ['traffic', 'trafficCars', 'movingCars', 'cars', 'vehicles']) || null;
}

// Elevated trains from the landmarks API as line segments along X: [{ x0, x1, y, z }] or null if not exposed.
// landmarks.rail.trains = [{ head, dir, z, cars, carLength, visible }], rail.railTop
export function trainSegments(ctx, out = []) {
  out.length = 0;
  const lm = ctx.api?.landmarks;
  if (!lm) return null;
  try {
    const rail = lm.rail;
    const list = rail?.trains || lm.trains;
    if (Array.isArray(list)) {
      for (const t of list) {
        if (!t || t.visible === false || !Number.isFinite(t.head)) continue;
        const len = (t.cars || 6) * (t.carLength || 20);
        const tail = t.head - (t.dir || 1) * len;
        out.push({ x0: Math.min(t.head, tail), x1: Math.max(t.head, tail), y: (rail?.railTop ?? rail?.height ?? 14) + 1.5, z: t.z ?? rail?.z ?? -140 });
      }
      return out;
    }
    const t = lm.train || rail?.train;
    const p = t && posOf(t);
    if (p) { out.push({ x0: p.x - 55, x1: p.x + 55, y: p.y + 1.5, z: p.z }); return out; }
  } catch { /* ignore */ }
  return null;
}
