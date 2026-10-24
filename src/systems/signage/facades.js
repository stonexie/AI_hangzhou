// Facade source for sign mounting. Uses ctx.api.buildings.facades when the buildings system provides it,
// otherwise derives "virtual" facades from LAYOUT so signage can be developed independently.
import * as THREE from 'three/webgpu';
import { mulberry32 } from './util.js';

const UP = new THREE.Vector3(0, 1, 0);

function mk(center, normal, width, height, district, shopfront, floorHeight = 3.4) {
  const n = normal.clone().normalize();
  const right = new THREE.Vector3().crossVectors(UP, n).normalize();
  return { center, normal: n, right, width, height, floors: Math.max(1, Math.floor(height / floorHeight)), floorHeight, district, shopfront, virtual: true };
}

export function alleyGroundY(L, x) {
  const s = L.alley.stairs;
  if (x > s.xStart) return 0;
  if (x < s.xEnd) return s.rise;
  return s.rise * (s.xStart - x) / (s.xStart - s.xEnd);
}

export function virtualFacades(L) {
  const rnd = mulberry32(9137);
  const out = [];
  const av = L.avenue, cs = L.crossStreets, B = L.blocks;
  const fx = av.x + B.frontageOffset;
  // avenue blocks split by cross streets
  const cuts = [av.zStart, ...cs.zs.flatMap((z) => [z + cs.roadHalfWidth + cs.sidewalkWidth, z - cs.roadHalfWidth - cs.sidewalkWidth]), av.zEnd];
  for (let i = 0; i < cuts.length; i += 2) {
    const z0 = cuts[i], z1 = cuts[i + 1];
    for (const side of [-1, 1]) {
      let z = z0;
      while (z > z1 + 4) {
        let w = rnd.range(8, 18);
        if (z - w < z1) w = z - z1;
        const zc = z - w / 2;
        // alley gap on west side
        if (side < 0 && Math.abs(zc - L.alley.z) < w / 2 + L.alley.width / 2) { z -= w; continue; }
        const h = rnd.range(B.minHeight, B.maxHeight);
        out.push(mk(new THREE.Vector3(side * fx, h / 2, zc), new THREE.Vector3(-side, 0, 0), w, h, 'avenue', true));
        z -= w;
      }
    }
  }
  // cross street facades
  for (const zc of cs.zs) {
    for (const sz of [-1, 1]) {
      const fz = zc + sz * (cs.roadHalfWidth + cs.sidewalkWidth);
      for (const [xa, xb] of [[cs.xStart, -fx], [fx, cs.xEnd]]) {
        let x = xa;
        while (x < xb - 4) {
          let w = rnd.range(9, 20);
          if (x + w > xb) w = xb - x;
          const h = rnd.range(B.minHeight, B.maxHeight * 0.8);
          out.push(mk(new THREE.Vector3(x + w / 2, h / 2, fz), new THREE.Vector3(0, 0, -sz), w, h, 'cross', true));
          x += w;
        }
      }
    }
  }
  // alley facades
  const al = L.alley;
  for (const sz of [-1, 1]) {
    const fz = al.z + sz * al.width / 2;
    let x = al.xStart;
    while (x > al.xEnd + 3) {
      let w = rnd.range(5, 10);
      if (x - w < al.xEnd) w = x - al.xEnd;
      const xc = x - w / 2;
      const gy = alleyGroundY(L, xc);
      const h = rnd.range(8, 22);
      out.push(mk(new THREE.Vector3(xc, gy + h / 2, fz), new THREE.Vector3(0, 0, -sz), w, h, 'alley', true, 3.0));
      x -= w;
    }
  }
  // river-facing facades (west of promenade)
  for (let z = 30; z > -480; z -= 16) {
    if (cs.zs.some((c) => Math.abs(c - (z - 8)) < 10)) continue;
    const h = rnd.range(14, 40);
    out.push(mk(new THREE.Vector3(L.promenade.xMin - 2, h / 2, z - 8), new THREE.Vector3(1, 0, 0), 15, h, 'river', rnd() < 0.5));
  }
  return out;
}

export function getFacades(ctx) {
  const real = ctx.api?.buildings?.facades;
  if (Array.isArray(real) && real.length > 20) {
    return real.map((f) => {
      const n = f.normal.clone().normalize();
      const right = f.right ? f.right.clone().normalize() : new THREE.Vector3().crossVectors(UP, n).normalize();
      return { ...f, normal: n, right, floorHeight: f.floorHeight || 3.4, floors: f.floors || Math.floor(f.height / 3.4) };
    });
  }
  console.log('[signage] buildings.facades not available — using virtual facades from LAYOUT');
  return virtualFacades(ctx.layout);
}
