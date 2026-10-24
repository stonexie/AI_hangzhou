// Ground traffic (avenue, cross streets, expressway) with IDM car-following + traffic signals, and flying AV lanes.
// Fully deterministic: seeded RNG for spawn, fixed dt in shot mode.
import * as THREE from 'three/webgpu';

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const PALETTE = {
  hero: [0x141619],
  // Compact hatchback / city car in varied modern colours
  kei: [0xd8d6d0, 0x2a3a52, 0x1c2026, 0xb7b9bc, 0x8c2228, 0xc9b48a, 0x244a66, 0x5c6873],
  // Authentic Hangzhou emerald / mint-jade green taxi livery (杭州翠绿出租车外壳)
  taxi: [0x129a6c, 0x16ad7a, 0x0f885f, 0x1cba86],
  // Civilian 3-box family sedans in Pearl White, Obsidian Black, Silver, Sapphire Blue, Burgundy Red, Titanium Grey, Champagne
  sedan: [0xedece6, 0x16191e, 0xb8bdc4, 0x1f3b5c, 0x7a1c24, 0x484e56, 0xc6b698],
  // Urban 5-door SUVs in Glacier White, Matte Charcoal, Forest Green, Midnight Blue, Warm Silver, Bronze Brown
  suv: [0xf0efe9, 0x262a30, 0x2d4234, 0x1b2d44, 0xa8adb4, 0x544234],
  van: [0xb4b4b0, 0xaaa8a2, 0x7d838a, 0x24425e, 0xbcbcb6],
  av: [0x1c2026, 0x2b3038],
};

const SIGNAL_CYCLE = 30;
// phase of an intersection: returns { avenue: 'g'|'y'|'r', cross: ... }
export function signalState(t, offset) {
  const p = ((t + offset) % SIGNAL_CYCLE + SIGNAL_CYCLE) % SIGNAL_CYCLE;
  const avenue = p < 14 ? 'g' : p < 17 ? 'y' : 'r';
  const cross = p >= 18 && p < 27 ? 'g' : p >= 27 && p < 30 ? 'y' : 'r';
  return { avenue, cross };
}

class Lane {
  constructor(o) {
    Object.assign(this, o);
    this.dir = o.dir.clone().normalize();
    this.cars = [];
    this.yaw = Math.atan2(-this.dir.x, -this.dir.z); // car forward is -Z
    this.quat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
    this.stops = o.stops || [];
  }
  point(s, out) { return out.copy(this.p0).addScaledVector(this.dir, s); }
}

export class Traffic {
  constructor(ctx, models, opts) {
    this.ctx = ctx; this.models = models;
    this.lanes = [];
    this.cars = [];
    this.rng = mulberry32(opts.seed || 1234);
    const L = ctx.layout;
    const av = L.avenue, cs = L.crossStreets;
    const crossZs = cs.zs;
    const offs = (z) => (-z / 60) * 3.0; // green wave offset
    const yA = 0;
    // --- avenue lanes (Japanese LEFT-hand traffic, matches the expressway). northbound (-Z) at -x, southbound (+Z) at +x
    const aStops = (sign) => crossZs.map((z) => ({ pos: z + sign * (cs.roadHalfWidth + 2.2), group: 'avenue', off: offs(z) }));
    this.addLane({ kind: 'avenue', p0: new THREE.Vector3(-1.5, yA, av.zStart), dir: new THREE.Vector3(0, 0, -1), length: av.zStart - av.zEnd, v0: 12, stopsAt: aStops(1), axis: 'z' });
    this.addLane({ kind: 'avenue', p0: new THREE.Vector3(1.5, yA, av.zEnd), dir: new THREE.Vector3(0, 0, 1), length: av.zStart - av.zEnd, v0: 12, stopsAt: aStops(-1), axis: 'z' });
    // --- cross streets: eastbound (+X) at z-1.6, westbound at z+1.6
    for (const z of crossZs) {
      const hw = av.roadHalfWidth + 2.2;
      this.addLane({ kind: 'cross', p0: new THREE.Vector3(cs.xStart, yA, z - 2.2), dir: new THREE.Vector3(1, 0, 0), length: cs.xEnd - cs.xStart, v0: 10, stopsAt: [{ pos: -hw, group: 'cross', off: offs(z) }], axis: 'x' });
      this.addLane({ kind: 'cross', p0: new THREE.Vector3(cs.xEnd, yA, z + 2.2), dir: new THREE.Vector3(-1, 0, 0), length: cs.xEnd - cs.xStart, v0: 10, stopsAt: [{ pos: hw, group: 'cross', off: offs(z) }], axis: 'x' });
    }
    // --- expressway (elevated): use the landmarks lane list when present
    const ex = opts.expressway;
    if (ex) {
      const lanes = ex.lanes?.length ? ex.lanes : [{ z: ex.z - 5.25, dir: 1 }, { z: ex.z - 1.75, dir: 1 }, { z: ex.z + 1.75, dir: -1 }, { z: ex.z + 5.25, dir: -1 }];
      lanes.forEach((ln, i) => {
        const v0 = (ex.speedLimit || 22) * (i % 2 ? 1.12 : 0.92);
        this.addLane({ kind: 'express', p0: new THREE.Vector3(ln.dir > 0 ? ex.xStart : ex.xEnd, ex.deckY, ln.z), dir: new THREE.Vector3(ln.dir, 0, 0), length: ex.xEnd - ex.xStart, v0, stopsAt: [], axis: 'x' });
      });
    }
    // --- populate: balanced mix of civilian sedans, urban SUVs, compact hatchbacks, green taxis (~18%), and vans
    const typeFor = (kind) => {
      const r = this.rng();
      if (kind === 'express') {
        return r < 0.22 ? 'van' : r < 0.44 ? 'sedan' : r < 0.66 ? 'suv' : r < 0.82 ? 'kei' : r < 0.93 ? 'taxi' : 'hero';
      }
      return r < 0.24 ? 'sedan' : r < 0.46 ? 'suv' : r < 0.66 ? 'kei' : r < 0.84 ? 'taxi' : r < 0.94 ? 'van' : 'hero';
    };
    for (const lane of this.lanes) {
      const spacing = lane.kind === 'express' ? 34 : lane.kind === 'avenue' ? 26 : 32;
      let s = this.rng() * spacing;
      while (s < lane.length - 8) {
        const type = typeFor(lane.kind);
        if (!models[type]) { s += spacing; continue; }
        const pal = PALETTE[type];
        const car = this.makeCar(type, new THREE.Color(pal[Math.floor(this.rng() * pal.length)]));
        car.lane = lane; car.s = s; car.v = lane.v0 * (0.75 + this.rng() * 0.3); car.v0 = lane.v0 * (0.85 + this.rng() * 0.3);
        lane.cars.push(car); this.cars.push(car);
        s += spacing * (0.6 + this.rng() * 1.1);
      }
      this.placeLaneCars(lane);
    }
  }

  addLane(o) {
    const lane = new Lane(o);
    // convert stop world coordinate to lane s
    lane.stops = (o.stopsAt || []).map((st) => {
      const p = o.axis === 'z' ? st.pos - lane.p0.z : st.pos - lane.p0.x;
      const s = o.axis === 'z' ? p / lane.dir.z : p / lane.dir.x;
      return { s, group: st.group, off: st.off };
    }).filter((st) => st.s > 0 && st.s < lane.length);
    this.lanes.push(lane);
    return lane;
  }

  makeCar(type, paint) {
    const M = this.models[type];
    return {
      type, kind: 'traffic', paint, pos: new THREE.Vector3(), quat: new THREE.Quaternion(), light: new THREE.Vector3(1, 1, 0),
      spin: 0, steer: 0, v: 0, s: 0, len: M.length, radius: M.length * 0.6, position: null, speed: 0,
    };
  }

  placeLaneCars(lane) {
    for (const c of lane.cars) {
      lane.point(c.s, c.pos);
      c.quat.copy(lane.quat);
      c.position = c.pos; c.speed = c.v;
    }
  }

  // obstacles: array of Vector3 (player / driven car) that traffic must not run into
  update(dt, t, obstacles) {
    const tmp = this._tmp || (this._tmp = new THREE.Vector3());
    for (const lane of this.lanes) {
      const cars = lane.cars;
      cars.sort((a, b) => b.s - a.s);
      // obstacles projected onto this lane
      const obsS = [];
      for (const o of obstacles) {
        tmp.subVectors(o, lane.p0);
        const s = tmp.dot(lane.dir);
        const lat = tmp.addScaledVector(lane.dir, -s);
        if (Math.abs(lat.x) + Math.abs(lat.z) < 2.0 && Math.abs(lat.y) < 3 && s > 0 && s < lane.length) obsS.push(s);
      }
      for (let i = 0; i < cars.length; i++) {
        const c = cars[i];
        let gap = 1e9, vLead = c.v0;
        if (i > 0) { const L = cars[i - 1]; gap = L.s - c.s - (L.len + c.len) * 0.5; vLead = L.v; }
        else if (cars.length > 1) { const L = cars[cars.length - 1]; gap = L.s + lane.length - c.s - (L.len + c.len) * 0.5; vLead = L.v; }
        // traffic signals
        for (const st of lane.stops) {
          const ds = st.s - c.s - c.len * 0.5;
          if (ds < -0.5 || ds > 60) continue;
          const sig = signalState(t, st.off)[st.group];
          const stopDist = (c.v * c.v) / (2 * 4.0);
          if (sig === 'r' || (sig === 'y' && ds > stopDist + 1)) { if (ds < gap) { gap = Math.max(ds, 0.01); vLead = 0; } }
        }
        for (const s of obsS) {
          const ds = s - c.s - c.len * 0.5 - 1.2;
          if (ds > -1 && ds < gap) { gap = Math.max(ds, 0.01); vLead = 0; }
        }
        // IDM
        const a = 2.2, b = 3.5, s0 = 2.2, T = 1.2;
        const dv = c.v - vLead;
        const sStar = s0 + Math.max(0, c.v * T + (c.v * dv) / (2 * Math.sqrt(a * b)));
        let acc = a * (1 - Math.pow(c.v / c.v0, 4) - Math.pow(sStar / Math.max(gap, 0.01), 2));
        acc = Math.max(acc, -9);
        c.v = Math.max(0, c.v + acc * dt);
        c.s += c.v * dt;
        c.brake = acc < -0.8 || c.v < 0.3 ? 1 : 0;
        if (c.s > lane.length) c.s -= lane.length;
        c.spin -= (c.v * dt) / (this.models[c.type].wheelRadius || 0.33);
        c.light.set(1, 1, c.brake);
        c.speed = c.v;
      }
      this.placeLaneCars(lane);
    }
  }
}

// ------------------------------------------------------------------------------------------------ 2 Aerial Photography Drones (航拍无人机)
export class SkyTraffic {
  constructor(models, opts = {}) {
    this.cars = [];
    if (!models.av) return;
    // Only 2 quadcopter drones patrolling gently above the Wulin Night Market street (instead of dozens of flying cars)
    const droneRoutes = [
      { cx: 0, cz: -32, h: 21, rx: 14, rz: 42, w: 0.14, th0: 0.2, bob: 0.0, color: 0x1c2026 },
      { cx: 6, cz: -85, h: 27, rx: 22, rz: 55, w: -0.11, th0: 2.4, bob: 2.1, color: 0x2b3038 },
    ];
    for (const d of droneRoutes) {
      this.cars.push({
        type: 'av',
        kind: 'flying',
        paint: new THREE.Color(d.color),
        pos: new THREE.Vector3(),
        quat: new THREE.Quaternion(),
        light: new THREE.Vector3(1, 1, 0),
        spin: 0,
        steer: 0,
        radius: 1.8,
        drone: d,
        position: null,
        speed: 0,
      });
    }
    this._e = new THREE.Euler(0, 0, 0, 'YXZ');
  }
  update(t) {
    const e = this._e;
    for (const c of this.cars) {
      const d = c.drone;
      const th = d.th0 + d.w * t;
      const x = d.cx + Math.cos(th) * d.rx;
      const z = d.cz + Math.sin(th) * d.rz;
      const y = d.h + Math.sin(t * 1.4 + d.bob) * 0.45;
      c.pos.set(x, y, z);
      const tx = -Math.sin(th) * d.rx * Math.sign(d.w);
      const tz = Math.cos(th) * d.rz * Math.sign(d.w);
      // Slight forward pitch and gentle bank while cruising
      e.set(-0.06, Math.atan2(-tx, -tz), Math.sign(d.w) * 0.08);
      c.quat.setFromEuler(e);
      c.speed = Math.abs(d.w) * (d.rx + d.rz) * 0.5;
      c.position = c.pos;
    }
  }
}
