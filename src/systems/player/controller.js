// Rapier kinematic character controller + first/third-person camera rig.
import * as THREE from 'three/webgpu';

const RADIUS = 0.32;
const HALF_STAND = 0.58;   // capsule cylinder half-height → total height 1.80 m
const HALF_CROUCH = 0.24;  // → 1.12 m
const EYE_STAND = 1.66;
const EYE_CROUCH = 1.02;
const GRAVITY = 21;
const JUMP_V = 6.6;        // ≈ 1.0 m jump apex
const WALK = 4.3, SPRINT = 7.8, CROUCH = 2.1;

const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));

export class PlayerController {
  constructor(ctx, settings) {
    this.ctx = ctx;
    this.settings = settings;
    const { RAPIER, world } = ctx.physics;
    this.RAPIER = RAPIER; this.world = world;
    const sp = ctx.layout.spawn;
    this.feet = new THREE.Vector3(sp.position[0], 0.05, sp.position[2]);
    this.yaw = sp.yaw || 0;
    this.pitch = -0.02;
    this.vel = new THREE.Vector3();
    this.vy = 0;
    this.grounded = false;
    this.crouch = false;
    this.crouchK = 0;
    this.sprinting = false;
    this.sprintK = 0;
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.camY = this.feet.y; // smoothed feet height for camera (hides autostep pops)
    this.bobPhase = 0; this.bobAmp = 0;
    this.dip = 0; this.dipVel = 0;
    this.roll = 0; this.swayYaw = 0; this.lookLag = 0;
    this.fov = settings.get('fov');
    this.view = 'fp';          // 'fp' | 'tp'
    this.viewK = 0;            // 0 = fp, 1 = tp (blended)
    this.armLen = 3.2;
    this.lastSafe = this.feet.clone();
    this.airTime = 0;
    this.lastStepSign = 0;

    // Parentless capsule collider (we drive its pose directly — immediate, frame-rate independent of physics steps).
    this.shapeStand = new RAPIER.Capsule(HALF_STAND, RADIUS);
    this.shapeCrouch = new RAPIER.Capsule(HALF_CROUCH, RADIUS);
    this.collider = world.createCollider(RAPIER.ColliderDesc.capsule(HALF_STAND, RADIUS).setTranslation(this.feet.x, this.feet.y + HALF_STAND + RADIUS, this.feet.z));
    this.kcc = world.createCharacterController(0.03);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.42, 0.18, false);
    this.kcc.enableSnapToGround(0.45);
    this.kcc.setMaxSlopeClimbAngle((52 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(true);
    this.kcc.setCharacterMass(80);

    this.ball = new RAPIER.Ball(0.2);
    this._v = new THREE.Vector3(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler(0, 0, 0, 'YXZ');
    this.camPos = new THREE.Vector3(); this.camQuat = new THREE.Quaternion();
    this.placed = false;
  }

  get half() { return this.crouch ? HALF_CROUCH : HALF_STAND; }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }

  setEnabled(on) { this.collider.setEnabled(on); }

  // Drop the player onto the highest surface under (x,z) (used at spawn and after exiting cars / elevators).
  placeAt(x, y, z, yaw) {
    const hit = this.world.castRay(new this.RAPIER.Ray({ x, y: y + 2, z }, { x: 0, y: -1, z: 0 }), 60, true, undefined, undefined, this.collider);
    const gy = hit ? y + 2 - hit.timeOfImpact : Math.max(0, y - 1.7);
    this.feet.set(x, gy + 0.05, z);
    this.camY = this.feet.y;
    this.vel.set(0, 0, 0); this.vy = 0;
    if (yaw !== undefined) this.yaw = yaw;
    this.syncCollider();
  }

  syncCollider() {
    const h = this.half;
    this.collider.setTranslation({ x: this.feet.x, y: this.feet.y + h + RADIUS, z: this.feet.z });
  }

  look(dx, dy) {
    const s = 0.0021 * this.settings.get('sensitivity');
    this.yaw -= dx * s;
    this.pitch -= dy * s * (this.settings.get('invertY') ? -1 : 1);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.lookLag += dx * s; // drives camera lean
  }

  hasHeadroom() {
    const top = this.feet.y + 2 * (HALF_CROUCH + RADIUS);
    const ray = new this.RAPIER.Ray({ x: this.feet.x, y: top, z: this.feet.z }, { x: 0, y: 1, z: 0 });
    return !this.world.castRay(ray, 2 * (HALF_STAND - HALF_CROUCH) + 0.1, true, undefined, undefined, this.collider);
  }

  // in: { fwd, right, sprint, crouchHeld, jump }
  step(dt, inp) {
    const events = [];
    // crouch (hold C / Ctrl)
    const wantCrouch = inp.crouchHeld;
    if (wantCrouch && !this.crouch) { this.crouch = true; this.collider.setShape(this.shapeCrouch); this.syncCollider(); }
    else if (!wantCrouch && this.crouch && this.hasHeadroom()) { this.crouch = false; this.collider.setShape(this.shapeStand); this.syncCollider(); }
    this.crouchK = damp(this.crouchK, this.crouch ? 1 : 0, 12, dt);

    const moving = inp.fwd !== 0 || inp.right !== 0;
    this.sprinting = inp.sprint && inp.fwd > 0 && !this.crouch && moving;
    this.sprintK = damp(this.sprintK, this.sprinting && this.speed > 4.5 ? 1 : 0, 5, dt);
    const maxSpeed = this.crouch ? CROUCH : this.sprinting ? SPRINT : WALK;

    // wish direction (yaw=0 looks down -Z)
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * inp.fwd + cy * inp.right;
    let wz = -cy * inp.fwd - sy * inp.right;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; }
    const tx = wx * maxSpeed * (moving ? 1 : 0), tz = wz * maxSpeed * (moving ? 1 : 0);
    const accel = this.grounded ? (moving ? 11 : 13) : 1.8;
    this.vel.x = damp(this.vel.x, tx, accel, dt);
    this.vel.z = damp(this.vel.z, tz, accel, dt);

    // jump with coyote time + input buffering
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    this.jumpBuffer = inp.jump ? 0.14 : Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && this.coyote > 0 && !this.crouch) {
      this.vy = JUMP_V; this.coyote = 0; this.jumpBuffer = 0; this.grounded = false;
      events.push({ type: 'jump' });
      this.dipVel += 0.6;
    }
    this.vy -= GRAVITY * dt;
    if (this.vy < -40) this.vy = -40;

    const wasGrounded = this.grounded;
    const prevVy = this.vy;
    const desired = { x: this.vel.x * dt, y: this.vy * dt, z: this.vel.z * dt };
    if (this.grounded && this.vy < 0) desired.y = Math.min(desired.y, -0.02);
    this.kcc.computeColliderMovement(this.collider, desired, this.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
    let m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded();
    // Manual stair step-up: Rapier's autostep misses box-edge stairs (capsule edge contact reads as a steep slope).
    const dh = Math.hypot(desired.x, desired.z), mh = Math.hypot(m.x, m.z);
    if ((wasGrounded || this.coyote > 0) && dh > 1e-4 && mh < dh * 0.6 && this.vy <= 0.01) {
      const st = this.tryStep(desired, m);
      if (st) { m = st; this.grounded = true; }
    }
    this.feet.x += m.x; this.feet.y += m.y; this.feet.z += m.z;
    // remove the velocity component pushing into walls (near-vertical contact normals only — slopes/stairs keep speed)
    if (!m.stepped) {
      const n = this.kcc.numComputedCollisions();
      for (let i = 0; i < n; i++) {
        const c = this.kcc.computedCollision(i, this._col);
        if (!c) continue;
        this._col = c;
        const nx = c.normal1.x, ny = c.normal1.y, nz = c.normal1.z;
        if (Math.abs(ny) > 0.45) continue; // floor / ramp / ceiling
        const hl = Math.hypot(nx, nz) || 1;
        const ux = nx / hl, uz = nz / hl;
        const into = this.vel.x * ux + this.vel.z * uz;
        if (into < 0) { this.vel.x -= into * ux; this.vel.z -= into * uz; }
      }
    }
    if (this.vy > 0 && m.y < desired.y * 0.5) this.vy = 0; // bonk head
    if (this.grounded && this.vy < 0) this.vy = 0;
    this.syncCollider();

    if (!this.grounded) this.airTime += dt;
    if (this.grounded && !wasGrounded) {
      const impact = Math.max(0, -prevVy);
      if (this.airTime > 0.12 || impact > 3) {
        this.dipVel -= Math.min(3.2, impact * 0.22);
        events.push({ type: 'land', impact });
      }
      this.airTime = 0;
    }
    if (this.grounded) this.lastSafe.copy(this.feet);
    if (this.feet.y < -40) { this.placeAt(this.lastSafe.x, this.lastSafe.y + 1, this.lastSafe.z); events.push({ type: 'respawn' }); }

    // smoothed camera height: follow fast on drops, ease on autostep rises
    const dy = this.feet.y - this.camY;
    if (!this.grounded || Math.abs(dy) > 1.2) this.camY = this.feet.y;
    else this.camY = damp(this.camY, this.feet.y, dy > 0 ? 14 : 22, dt);

    // head-bob phase
    const spd = this.grounded ? this.speed : 0;
    const targetAmp = Math.min(1, spd / WALK) * (this.sprinting ? 1.6 : 1) * (this.crouch ? 0.6 : 1);
    this.bobAmp = damp(this.bobAmp, targetAmp, 8, dt);
    const prevPhase = this.bobPhase;
    this.bobPhase += dt * (this.sprinting ? 7.4 : 5.6) * Math.min(1.2, 0.35 + spd / WALK * 0.65);
    if (spd > 0.8 && Math.floor(prevPhase / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) events.push({ type: 'footstep', sprint: this.sprinting, crouch: this.crouch });

    // landing-dip spring
    const k = 140, c = 15;
    this.dipVel += (-k * this.dip - c * this.dipVel) * dt;
    this.dip += this.dipVel * dt;
    return events;
  }

  // up → forward → down sweep; returns the combined movement or null if it doesn't make real progress.
  tryStep(desired, base) {
    const STEP = 0.45;
    const R = this.RAPIER, flags = R.QueryFilterFlags.EXCLUDE_SENSORS;
    const h = this.half + RADIUS;
    const p0 = { x: this.feet.x, y: this.feet.y + h, z: this.feet.z };
    const set = (x, y, z) => this.collider.setTranslation({ x, y, z });
    // a bit more forward reach than this frame's move so slow walking still clears the riser
    const dh = Math.hypot(desired.x, desired.z);
    const reach = Math.max(dh, 0.22) / dh;
    this.kcc.computeColliderMovement(this.collider, { x: 0, y: STEP, z: 0 }, flags);
    const up = this.kcc.computedMovement();
    if (up.y < 0.1) { this._stepDbg = { failUp: up.y }; return null; }
    set(p0.x, p0.y + up.y, p0.z);
    this.kcc.computeColliderMovement(this.collider, { x: desired.x * reach, y: 0, z: desired.z * reach }, flags);
    const fw = this.kcc.computedMovement();
    const fh = Math.hypot(fw.x, fw.z);
    if (fh < Math.hypot(base.x, base.z) + 0.02) { set(p0.x, p0.y, p0.z); this._stepDbg = { failFw: fh, up: up.y, base: Math.hypot(base.x, base.z) }; return null; }
    // keep the full probe reach: the rounded capsule has to get its centre over the tread to land on it
    const fx = fw.x, fz = fw.z;
    set(p0.x + fx, p0.y + up.y, p0.z + fz);
    this.kcc.computeColliderMovement(this.collider, { x: 0, y: -(up.y + 0.08), z: 0 }, flags);
    const dn = this.kcc.computedMovement();
    const grounded = this.kcc.computedGrounded();
    set(p0.x, p0.y, p0.z);
    const rise = up.y + dn.y;
    this._stepDbg = { up: up.y, fh, base: Math.hypot(base.x, base.z), dn: dn.y, grounded };
    if (!grounded || rise < 0.02 || rise > STEP) return null;
    return { x: fx, y: rise, z: fz, stepped: true };
  }

  toggleView() { this.view = this.view === 'fp' ? 'tp' : 'fp'; }

  // Computes camera transform; writes to camera. avatarYaw is set by caller.
  updateCamera(dt, camera, t) {
    const sw = this.settings.get('cameraSway') ? 1 : 0;
    const hb = this.settings.get('headBob') ? 1 : 0;
    this.viewK = damp(this.viewK, this.view === 'tp' ? 1 : 0, 9, dt);

    // lean / roll from strafe velocity and mouse yaw rate
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    const localRight = this.vel.x * cy - this.vel.z * sy;
    this.lookLag = damp(this.lookLag, 0, 10, dt);
    const targetRoll = (-localRight * 0.0042 - this.lookLag * 0.35) * sw;
    this.roll = damp(this.roll, targetRoll, 7, dt);

    const eye = THREE.MathUtils.lerp(EYE_STAND, EYE_CROUCH, this.crouchK);
    const bobY = Math.sin(this.bobPhase * 2) * 0.034 * this.bobAmp * hb;
    const bobX = Math.cos(this.bobPhase) * 0.026 * this.bobAmp * hb;
    const breathe = Math.sin(t * 1.3) * 0.004 * sw;
    const idlePitch = (Math.sin(t * 0.9) * 0.0035 + Math.sin(t * 0.37) * 0.002) * sw;
    const idleYaw = Math.sin(t * 0.53) * 0.0025 * sw;

    // FP pose
    const fpPos = this._v.set(
      this.feet.x + cy * bobX,
      this.camY + eye + bobY + breathe + this.dip * 0.09,
      this.feet.z - sy * bobX,
    );
    const pitch = this.pitch + idlePitch + this.dip * 0.035 - Math.abs(Math.sin(this.bobPhase)) * 0.004 * this.bobAmp * hb;
    this._e.set(pitch, this.yaw + idleYaw, this.roll + Math.cos(this.bobPhase) * 0.004 * this.bobAmp * hb);
    const fpQuat = this._q.setFromEuler(this._e);

    if (this.viewK < 0.001) {
      camera.position.copy(fpPos); camera.quaternion.copy(fpQuat);
    } else {
      // TP spring arm (over-the-shoulder), collision-aware against Rapier
      const pivot = new THREE.Vector3(this.feet.x, this.camY + THREE.MathUtils.lerp(1.6, 1.1, this.crouchK) + this.dip * 0.05, this.feet.z);
      const e2 = new THREE.Euler(this.pitch * 0.85 - 0.06, this.yaw, this.roll * 0.4, 'YXZ');
      const q2 = new THREE.Quaternion().setFromEuler(e2);
      // over-the-shoulder offset; auto-swaps to the other shoulder when hugging a wall on that side
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q2);
      const freeR = this.castBall(pivot, right, 0.9), freeL = this.castBall(pivot, right.clone().negate(), 0.9);
      if (freeR < 0.45 && freeL > freeR + 0.2) this.shoulderSide = -1;
      else if (freeL < 0.45 && freeR > freeL + 0.2) this.shoulderSide = 1;
      else if (freeR >= 0.85) this.shoulderSide = 1;
      this.shoulderK = damp(this.shoulderK ?? 1, this.shoulderSide ?? 1, 5, dt);
      const shoulder = new THREE.Vector3(0.55 * this.shoulderK, 0.12, 0).applyQuaternion(q2);
      const start = pivot.clone().addScaledVector(shoulder, 1);
      // keep shoulder offset itself from entering walls
      const sl = shoulder.length();
      const sh = this.castBall(pivot, shoulder.clone().divideScalar(sl || 1), sl);
      if (sh < sl) start.copy(pivot).addScaledVector(shoulder, Math.max(0, sh - 0.05) / (sl || 1));
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q2);
      const maxLen = 3.1 + this.sprintK * 0.6;
      const hit = this.castBall(start, back, maxLen);
      const target = Math.max(0.35, hit - 0.08);
      this.armLen = target < this.armLen ? target : damp(this.armLen, target, 3.5, dt);
      const tpPos = start.addScaledVector(back, this.armLen);
      camera.position.lerpVectors(fpPos, tpPos, this.viewK);
      camera.quaternion.slerpQuaternions(fpQuat, q2, this.viewK);
    }

    const fovT = this.settings.get('fov') + this.sprintK * 8 + (this.grounded ? 0 : 2) + this.viewK * -4;
    this.fov = damp(this.fov, fovT, 6, dt);
    if (Math.abs(camera.fov - this.fov) > 0.01) { camera.fov = this.fov; camera.updateProjectionMatrix(); }
  }

  castBall(from, dir, maxToi) {
    const hit = this.world.castShape(
      { x: from.x, y: from.y, z: from.z }, { x: 0, y: 0, z: 0, w: 1 }, { x: dir.x, y: dir.y, z: dir.z },
      this.ball, 0, maxToi, true, this.RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, undefined, this.collider,
    );
    return hit ? hit.time_of_impact ?? hit.timeOfImpact ?? maxToi : maxToi;
  }
}
