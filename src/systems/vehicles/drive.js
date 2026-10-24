// Drivable car: Rapier DynamicRayCastVehicleController with arcade-sim tuning (rear-drive, handbrake drift,
// speed-sensitive steering, downforce, anti-roll assist) + chase camera.
import * as THREE from 'three/webgpu';

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
export let ENGINE_SIGN = -1; // chassis forward axis is +Z in Rapier, our cars face -Z
export let STEER_SIGN = 1;
export function setSigns(e, s) { ENGINE_SIGN = e; STEER_SIGN = s; }

const TUNE = {
  hero: { mass: 1550, engine: 7800, brake: 95, maxSteer: 0.55, grip: 2.4, rearGrip: 2.15, drift: 0.75, top: 68 },
  kei: { mass: 850, engine: 3200, brake: 55, maxSteer: 0.6, grip: 2.1, rearGrip: 2.0, drift: 0.8, top: 40 },
  taxi: { mass: 1350, engine: 5200, brake: 80, maxSteer: 0.55, grip: 2.2, rearGrip: 2.05, drift: 0.8, top: 50 },
  van: { mass: 3200, engine: 9500, brake: 160, maxSteer: 0.5, grip: 2.0, rearGrip: 2.0, drift: 0.85, top: 36 },
};

export class DrivenCar {
  constructor(ctx, car, model) {
    this.ctx = ctx; this.car = car; this.M = model;
    const { RAPIER, world } = ctx.physics;
    const T = this.T = TUNE[car.type] || TUNE.hero;
    const L = model.length, W = model.width, H = model.height;
    const R = model.wheelRadius;
    this.R = R;
    // chassis
    const desc = RAPIER.RigidBodyDesc.dynamic()
      .setTranslation(car.pos.x, car.pos.y + 0.05, car.pos.z)
      .setRotation({ x: car.quat.x, y: car.quat.y, z: car.quat.z, w: car.quat.w })
      .setLinearDamping(0.05).setAngularDamping(0.6).setCanSleep(false).setCcdEnabled(true);
    this.body = world.createRigidBody(desc);
    this.body.userData = { object: car.object, vehicle: car };
    const hy = Math.min(0.38, H * 0.3);
    // low centre of mass: collider set lower + extra additional mass handled via density
    const vol = (W * 0.92) * (2 * hy) * (L * 0.96);
    const cDesc = RAPIER.ColliderDesc.cuboid(W * 0.46, hy, L * 0.48).setTranslation(0, R + hy * 0.7, 0)
      .setDensity(T.mass / vol).setFriction(0.4).setRestitution(0.05);
    this.collider = world.createCollider(cDesc, this.body);
    // upper cabin collider (no mass) so walls/players hit the greenhouse too
    this.cabin = world.createCollider(RAPIER.ColliderDesc.cuboid(W * 0.38, H * 0.18, L * 0.26).setTranslation(0, H * 0.78, L * 0.04).setDensity(0.0).setFriction(0.3), this.body);
    this.body.setAdditionalMassProperties(0, { x: 0, y: R + 0.05, z: 0 }, { x: T.mass * 0.4, y: T.mass * 0.5, z: T.mass * 0.15 }, { x: 0, y: 0, z: 0, w: 1 }, true);
    // vehicle controller
    const vc = this.vc = world.createVehicleController(this.body);
    try { vc.indexUpAxis = 1; } catch {}
    try { vc.setIndexForwardAxis = 2; } catch {}
    const rest = 0.22;
    this.rest = rest;
    model.slots.forEach((sl, i) => {
      const conn = { x: sl.pos.x, y: sl.pos.y + rest * 0.55, z: sl.pos.z };
      vc.addWheel(conn, { x: 0, y: -1, z: 0 }, { x: -1, y: 0, z: 0 }, rest, R);
      vc.setWheelSuspensionStiffness(i, 26);
      vc.setWheelSuspensionCompression(i, 2.6);
      vc.setWheelSuspensionRelaxation(i, 3.2);
      vc.setWheelMaxSuspensionTravel(i, 0.18);
      vc.setWheelMaxSuspensionForce(i, T.mass * 40);
      vc.setWheelFrictionSlip(i, sl.front ? T.grip : T.rearGrip);
      vc.setWheelSideFrictionStiffness(i, 1.0);
    });
    this.front = model.slots.map((s) => s.front);
    this.steer = 0; this.speed = 0; this.spin = 0; this.reverse = false;
    this.susp = model.slots.map(() => 0);
    car.susp = this.susp;
    this.camYaw = null; this.camPos = new THREE.Vector3(); this.camLook = new THREE.Vector3(); this.camInit = false;
    this.camYawOff = 0; this.camPitchOff = 0; this.lookIdle = 0;
  }

  dispose() {
    const { world } = this.ctx.physics;
    try { world.removeVehicleController(this.vc); } catch {}
    try { world.removeRigidBody(this.body); } catch {}
    this.car.susp = null;
  }

  // input: { throttle (-1..1), steer (-1..1, +right), handbrake bool, boost bool }
  step(dt, input) {
    const vc = this.vc, T = this.T, car = this.car;
    // read physics state (world already stepped this frame)
    const tr = this.body.translation(), rot = this.body.rotation();
    car.pos.set(tr.x, tr.y, tr.z);
    car.quat.set(rot.x, rot.y, rot.z, rot.w);
    if (car.object) { car.object.position.copy(car.pos); car.object.quaternion.copy(car.quat); car.object.updateMatrixWorld(); }
    const lv = this.body.linvel();
    const fwd = _v.set(0, 0, -1).applyQuaternion(car.quat);
    const vF = lv.x * fwd.x + lv.y * fwd.y + lv.z * fwd.z;
    this.speed = vF;
    car.speed = Math.abs(vF);
    // steering: speed-sensitive, smooth
    const sp = Math.abs(vF);
    const maxSteer = T.maxSteer / (1 + sp * 0.045);
    const target = -input.steer * maxSteer;
    this.steer += (target - this.steer) * Math.min(1, dt * (input.steer ? 7 : 10));
    // throttle / brake / reverse
    let engine = 0, brake = 0;
    if (input.throttle > 0) {
      if (vF < -0.8) brake = T.brake; else engine = T.engine * input.throttle * (input.boost ? 1.45 : 1);
    } else if (input.throttle < 0) {
      if (vF > 0.8) brake = T.brake; else engine = T.engine * 0.55 * input.throttle;
    } else brake = 1.2;
    if (sp > T.top * (input.boost ? 1.2 : 1)) engine = 0;
    this.reverse = vF < -0.5 && input.throttle < 0;
    car.reverse = this.reverse;
    // forward axis is +Z of the chassis in Rapier (index 2) but our car faces -Z -> negate engine force
    const n = vc.numWheels();
    for (let i = 0; i < n; i++) {
      const isF = this.front[i];
      vc.setWheelSteering(i, isF ? this.steer * STEER_SIGN : 0);
      vc.setWheelEngineForce(i, ENGINE_SIGN * (isF ? engine * 0.25 : engine * 0.75));
      let b = brake * (isF ? 0.6 : 0.4);
      if (input.handbrake && !isF) b = T.brake * 1.6;
      vc.setWheelBrake(i, b);
      // drift: handbrake drops rear grip
      vc.setWheelFrictionSlip(i, isF ? T.grip : (input.handbrake ? T.rearGrip * T.drift * 0.6 : T.rearGrip));
      vc.setWheelSideFrictionStiffness(i, !isF && input.handbrake ? 0.45 : 1.0);
    }
    // downforce + anti-flip assist
    const down = sp * sp * 0.9;
    this.body.addForce({ x: 0, y: -down, z: 0 }, true);
    const upv = _v2.set(0, 1, 0).applyQuaternion(car.quat);
    if (upv.y < 0.75) {
      const ax = new THREE.Vector3().crossVectors(upv, UP).multiplyScalar(T.mass * 6);
      this.body.applyTorqueImpulse({ x: ax.x * dt, y: 0, z: ax.z * dt }, true);
    }
    vc.updateVehicle(dt);
    // visuals
    this.spin -= (vF * dt) / this.R;
    car.spin = this.spin;
    car.steer = this.steer;
    for (let i = 0; i < n; i++) {
      const sl = vc.wheelSuspensionLength(i);
      this.susp[i] = sl != null ? (this.rest * 0.55 - sl + 0.0) : 0;
    }
    car.light.set(1, 1, brake > 2 || (input.throttle < 0 && vF > 0.5) || input.handbrake ? 1 : 0);
  }

  reset() {
    const p = this.car.pos;
    _e.setFromQuaternion(this.car.quat, 'YXZ');
    _q.setFromEuler(_e.set(0, _e.y, 0, 'YXZ'));
    this.body.setTranslation({ x: p.x, y: p.y + 1.0, z: p.z }, true);
    this.body.setRotation({ x: _q.x, y: _q.y, z: _q.z, w: _q.w }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  chase(camera, dt, mouse) {
    const car = this.car;
    _e.setFromQuaternion(car.quat, 'YXZ');
    const yaw = _e.y;
    const lv = this.body.linvel();
    const sp = Math.hypot(lv.x, lv.z);
    // follow velocity direction when moving fast (drift view), else car heading
    let wantYaw = yaw;
    if (sp > 4) {
      const vy = Math.atan2(-lv.x, -lv.z);
      const fwdDot = Math.cos(vy - yaw);
      if (fwdDot > 0) wantYaw = yaw + Math.atan2(Math.sin(vy - yaw), Math.cos(vy - yaw)) * 0.45;
    }
    if (this.camYaw == null) this.camYaw = wantYaw;
    let d = wantYaw - this.camYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    this.camYaw += d * Math.min(1, dt * 4.5);
    if (mouse && (mouse.dx || mouse.dy)) {
      this.camYawOff -= mouse.dx * 0.003; this.camPitchOff = THREE.MathUtils.clamp(this.camPitchOff - mouse.dy * 0.002, -0.25, 0.5);
      this.lookIdle = 0;
    } else {
      this.lookIdle += dt;
      if (this.lookIdle > 1.2) { this.camYawOff *= Math.exp(-dt * 2.5); this.camPitchOff *= Math.exp(-dt * 2.5); }
    }
    const M = this.M;
    const dist = M.length * 1.18 + 1.6 + sp * 0.025;
    const height = M.height * 1.05 + 0.55;
    const cy = this.camYaw + this.camYawOff;
    const want = _v.set(Math.sin(cy) * dist, height + this.camPitchOff * dist, Math.cos(cy) * dist).add(car.pos);
    if (!this.camInit) { this.camPos.copy(want); this.camInit = true; }
    this.camPos.lerp(want, 1 - Math.exp(-dt * 9));
    // keep camera out of walls: ray from car to camera
    const { world, RAPIER } = this.ctx.physics;
    const origin = _v2.set(car.pos.x, car.pos.y + M.height * 0.8, car.pos.z);
    const dir = new THREE.Vector3().subVectors(this.camPos, origin);
    const len = dir.length(); dir.normalize();
    try {
      const ray = new RAPIER.Ray(origin, dir);
      const hit = world.castRay(ray, len, true, undefined, undefined, undefined, this.body);
      if (hit && hit.timeOfImpact < len) camera.position.copy(origin).addScaledVector(dir, Math.max(0.8, hit.timeOfImpact - 0.25));
      else camera.position.copy(this.camPos);
    } catch { camera.position.copy(this.camPos); }
    this.camLook.set(car.pos.x, car.pos.y + M.height * 0.72, car.pos.z).addScaledVector(_v.set(-Math.sin(yaw), 0, -Math.cos(yaw)), 2.5);
    camera.lookAt(this.camLook);
    const fov = 62 + Math.min(sp, 60) * 0.22;
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov += (fov - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix(); }
  }
}
