// Vehicles workstream: Blender-built car models (assets/models/vehicles/*.glb), instanced rendering with LOD,
// TSL car paint with rain, parked cars, AI traffic (avenue / cross streets / expressway), flying AV lanes,
// hero car for the 'street' shot, drivable cars (Rapier ray-cast vehicle) + chase camera.
//
// ctx.api.vehicles = {
//   nearestCar(pos) -> car|null, enter(car) -> car, exit() -> undefined (player picks the exit spot),
//   activeCar, updateChaseCamera(camera, dt), traffic (array of moving cars with .position/.speed),
//   cars (all ground cars), flying (AV array), resetCar(), handlesInput: true
// }
// Car records: { type, kind: 'parked'|'traffic'|'hero'|'driven'|'flying', position (Vector3), quat, object (Object3D proxy, forward = -Z), speed, reverse, name }
import * as THREE from 'three/webgpu';
import { loadModels } from './models.js';
import { Fleet } from './fleet.js';
import { Traffic, SkyTraffic, mulberry32, PALETTE } from './traffic.js';
import { VehicleLights } from './lights.js';
import { DrivenCar } from './drive.js';

const NAMES = {
  hero: '西子智驾·凌波轿跑',
  kei: '现代两厢小轿车',
  taxi: '杭州翠绿出租车',
  sedan: '现代家用三厢轿车',
  suv: '都市家用SUV',
  van: '武林夜市货运车',
  av: '西湖航拍无人机',
};
const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);

function yawQuat(yaw) { return new THREE.Quaternion().setFromAxisAngle(Y, yaw); }

export default {
  async init(ctx) {
    this.ctx = ctx;
    const t0 = performance.now();
    this.dbgFreeze = new URLSearchParams(location.search).get('vdbg') === 'freeze';
    const models = this.models = await loadModels(ctx);
    if (!Object.keys(models).length) { console.warn('[vehicles] no models'); return; }
    const L = ctx.layout;
    const rng = mulberry32(90210);
    this.proxyRoot = new THREE.Group(); this.proxyRoot.name = 'vehicle_proxies'; ctx.scene.add(this.proxyRoot);

    // ---------------------------------------------------------------- parked cars
    this.parked = [];
    const parkTypes = () => {
      const r = rng();
      return r < 0.25 ? 'sedan' : r < 0.48 ? 'suv' : r < 0.68 ? 'kei' : r < 0.86 ? 'taxi' : r < 0.95 ? 'van' : 'hero';
    };
    const addParked = (type, x, z, yaw, colorHex) => {
      if (!models[type]) return null;
      const pal = PALETTE[type];
      const car = this.makeRecord(type, 'parked', new THREE.Vector3(x, 0, z), yaw, new THREE.Color(colorHex ?? pal[Math.floor(rng() * pal.length)]));
      car.light.set(0, type === 'taxi' ? 0.85 : 0, 0);
      this.parked.push(car);
      return car;
    };
    const av = L.avenue, cs = L.crossStreets;
    const curbX = av.roadHalfWidth - 1.15;
    for (const side of [-1, 1]) {
      for (let z = av.zStart - 8; z > av.zEnd + 10; z -= 6.4 + rng() * 1.6) {
        if (cs.zs.some((zc) => Math.abs(z - zc) < cs.roadHalfWidth + 8)) continue;
        if (side < 0 && Math.abs(z - L.alley.z) < L.alley.width + 4) continue;
        if (side > 0 && z > 6 && z < 30) continue; // keep spawn kerb clear (hero parks there)
        if (side < 0 && z > -4 && z < 34) continue; // keep ramen-shop frontage open for the street shot
        if (rng() > 0.62) continue;
        // left-hand traffic: cars on the west kerb face north (-Z), east kerb face south (+Z)
        addParked(parkTypes(), side * (curbX + (rng() - 0.5) * 0.15), z, side < 0 ? 0 : Math.PI + (rng() - 0.5) * 0.04);
      }
    }
    for (const zc of cs.zs) {
      for (const side of [-1, 1]) {
        for (let x = cs.xStart + 15; x < cs.xEnd - 10; x += 6.6 + rng() * 2) {
          if (Math.abs(x) < av.roadHalfWidth + av.sidewalkWidth + 8) continue;
          if (rng() > 0.4) continue;
          const cr = rng();
          const cType = cr < 0.34 ? 'sedan' : cr < 0.64 ? 'suv' : cr < 0.84 ? 'kei' : 'taxi';
          addParked(cType, x, zc + side * (cs.roadHalfWidth - 0.92), side < 0 ? -Math.PI / 2 : Math.PI / 2);
        }
      }
    }
    // hero: in shot mode drives up the avenue (ref panel 1); in play mode parked at the spawn kerb, ready to steal
    const heroPos = ctx.isShot ? new THREE.Vector3(-1.4, 0, 16.4) : new THREE.Vector3(curbX, 0, 15);
    this.hero = this.makeRecord('hero', ctx.isShot ? 'hero' : 'parked', heroPos, ctx.isShot ? 0 : 0, new THREE.Color(0x07070a));
    this.hero.light.set(1, 1, 0);
    this.hero.solo = true;
    this.parked.push(this.hero);

    // ---------------------------------------------------------------- traffic
    const lm = ctx.api.landmarks?.expressway;
    const E = L.expressway;
    const expressway = lm ? { z: lm.z ?? E.z, deckY: lm.surfaceY ?? lm.height ?? E.height, xStart: lm.xStart ?? E.xStart, xEnd: lm.xEnd ?? E.xEnd, lanes: lm.lanes, speedLimit: lm.speedLimit }
      : { z: E.z, deckY: E.height, xStart: E.xStart, xEnd: E.xEnd };
    this.traffic = new Traffic(ctx, models, { seed: 4242, expressway });
    this.sky = new SkyTraffic(models, { seed: 777 });
    // warm up traffic so it is already flowing (deterministic)
    for (let i = 0; i < 600; i++) this.traffic.update(1 / 30, -20 + i / 30, []);

    // ---------------------------------------------------------------- rendering
    const cap = {};
    const count = (c) => { cap[c.type] = (cap[c.type] || 0) + 1; };
    this.parked.forEach(count); this.traffic.cars.forEach(count); this.sky.cars.forEach(count);
    for (const k in cap) cap[k] += 2;
    this.fleet = new Fleet(ctx.scene, models, cap);
    this.lights = new VehicleLights(ctx.scene, models, { navCap: this.sky.cars.length + 4 });

    // ---------------------------------------------------------------- physics
    const { RAPIER, world } = ctx.physics;
    for (const car of this.parked) this.addParkedCollider(car);
    // kinematic colliders for the nearest traffic cars
    this.kin = [];
    for (let i = 0; i < 18; i++) {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -100 - i * 5, 0));
      const c = world.createCollider(RAPIER.ColliderDesc.cuboid(0.9, 0.7, 2.2).setTranslation(0, 0.75, 0), b);
      this.kin.push({ b, c, type: null });
    }

    this.driven = null; this.loose = [];
    this.allGround = [...this.parked, ...this.traffic.cars];
    this.all = [...this.allGround, ...this.sky.cars];
    const self = this;
    ctx.api.vehicles = {
      handlesInput: true,
      get activeCar() { return self.driven ? self.driven.car : null; },
      get traffic() { return self.traffic.cars; },
      get cars() { return self.allGround; },
      get flying() { return self.sky.cars; },
      get hero() { return self.hero; },
      nearestCar: (pos) => self.nearestCar(pos),
      enter: (car) => self.enter(car),
      exit: () => self.exit(),
      updateChaseCamera: (camera, dt) => self.driven?.chase(camera, dt, ctx.input.mouse),
      resetCar: () => self.driven?.reset(),
    };
    console.log(`[vehicles] ${this.parked.length} parked, ${this.traffic.cars.length} traffic, ${this.sky.cars.length} flying, init ${(performance.now() - t0).toFixed(0)}ms`);
  },

  makeRecord(type, kind, pos, yaw, paint) {
    const M = this.models[type];
    const obj = new THREE.Group();
    obj.name = 'car_' + type;
    obj.position.copy(pos); obj.quaternion.copy(yawQuat(yaw));
    this.proxyRoot.add(obj);
    const car = {
      type, kind, name: NAMES[type], model: type, object: obj, pos: obj.position, position: obj.position, quat: obj.quaternion,
      paint, light: new THREE.Vector3(0, 0, 0), spin: 0, steer: 0, speed: 0, reverse: false, radius: M.length * 0.6,
    };
    return car;
  },

  addParkedCollider(car) {
    const { RAPIER, world } = this.ctx.physics;
    const M = this.models[car.type];
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(car.pos.x, car.pos.y, car.pos.z)
      .setRotation({ x: car.quat.x, y: car.quat.y, z: car.quat.z, w: car.quat.w }));
    b.userData = { object: car.object, vehicle: car };
    const cy = M.box.min.y + (M.box.max.y - M.box.min.y) * 0.5;
    world.createCollider(RAPIER.ColliderDesc.cuboid(M.width * 0.46, (M.box.max.y - M.box.min.y) * 0.45, M.length * 0.48).setTranslation(0, cy, (M.box.min.z + M.box.max.z) * 0.5), b);
    car.fixedBody = b;
  },

  nearestCar(pos) {
    let best = null, bd = Infinity;
    const cands = this.parked.concat(this.loose.map((d) => d.car));
    for (const c of cands) {
      if (c.kind === 'driven' && c === this.driven?.car) continue;
      const d = c.pos.distanceToSquared(pos);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  },

  enter(car) {
    if (!car || !this.models[car.type] || car.type === 'av') throw new Error('not drivable');
    if (this.driven) this.exit();
    const { world } = this.ctx.physics;
    let d = this.loose.find((x) => x.car === car);
    if (d) this.loose.splice(this.loose.indexOf(d), 1);
    else {
      if (car.fixedBody) { world.removeRigidBody(car.fixedBody); car.fixedBody = null; }
      d = new DrivenCar(this.ctx, car, this.models[car.type]);
    }
    car.kind = 'driven';
    car.solo = true;
    car.light.set(1, 1, 0);
    this.driven = d;
    return car;
  },

  exit() {
    const d = this.driven;
    if (!d) return undefined;
    this.driven = null;
    d.car.kind = 'parked';
    d.car.light.set(0, 0.25, 0);
    this.loose.push(d);
    return undefined;
  },

  update(dt, t, ctx) {
    if (!this.fleet) return;
    const paused = ctx.paused;
    const sdt = paused ? 0 : dt;
    // driven car
    if (this.driven) {
      const i = ctx.input;
      const playing = !paused && (ctx.api.player?.state ?? 'playing') === 'playing';
      const inp = playing ? {
        throttle: (i.down('KeyW') || i.down('ArrowUp') ? 1 : 0) - (i.down('KeyS') || i.down('ArrowDown') ? 1 : 0),
        steer: (i.down('KeyD') || i.down('ArrowRight') ? 1 : 0) - (i.down('KeyA') || i.down('ArrowLeft') ? 1 : 0),
        handbrake: i.down('Space'), boost: i.down('ShiftLeft') || i.down('ShiftRight'),
      } : { throttle: 0, steer: 0, handbrake: true, boost: false };
      if (playing && i.justPressed('KeyR')) this.driven.reset();
      this.driven.step(dt, inp);
    }
    for (const d of this.loose) d.step(dt, { throttle: 0, steer: 0, handbrake: true, boost: false });
    // hero car (shot mode): deterministic slow roll up the avenue, tail bar glowing
    if (this.hero.kind === 'hero') {
      const v = 2.2;
      this.hero.pos.set(-1.4, 0, 16.4 - v * t);
      this.hero.spin = -(v * t) / this.models.hero.wheelRadius;
      this.hero.light.set(1, 1, 0.2);
    }
    // traffic + sky
    const obstacles = this._obs || (this._obs = []);
    obstacles.length = 0;
    if (this.driven) obstacles.push(this.driven.car.pos);
    for (const d of this.loose) obstacles.push(d.car.pos);
    if (this.hero.kind === 'hero') obstacles.push(this.hero.pos);
    const pp = ctx.api.player?.object?.position;
    if (pp && ctx.api.player.mode === 'foot') obstacles.push(pp);
    if (sdt > 0 && !this.dbgFreeze) this.traffic.update(sdt, t, obstacles);
    this.sky.update(t);
    // kinematic colliders follow the nearest traffic cars to the focus point
    const focus = this.driven ? this.driven.car.pos : (pp || ctx.camera.position);
    const near = this._near || (this._near = []);
    near.length = 0;
    for (const c of this.traffic.cars) { c._fd = c.pos.distanceToSquared(focus); if (c._fd < 60 * 60) near.push(c); }
    near.sort((a, b) => a._fd - b._fd);
    for (let k = 0; k < this.kin.length; k++) {
      const K = this.kin[k], c = near[k];
      if (c) { K.b.setNextKinematicTranslation({ x: c.pos.x, y: c.pos.y, z: c.pos.z }); K.b.setNextKinematicRotation({ x: c.quat.x, y: c.quat.y, z: c.quat.z, w: c.quat.w }); }
      else K.b.setNextKinematicTranslation({ x: 0, y: -100 - k * 5, z: 0 });
    }
  },

  postUpdate(dt, t, ctx) {
    if (!this.fleet) return;
    const cam = ctx.camera;
    cam.updateMatrixWorld();
    const visible = this.fleet.update(this.all, cam);
    const spotCar = this.driven ? this.driven.car : (this.hero.kind === 'hero' ? this.hero : null);
    this.lights.update(visible, this.allGround, this.sky.cars, cam, spotCar);
  },
};
