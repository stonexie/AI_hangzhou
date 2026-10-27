// The NEON KAIDO soundscape: rain layers, city bed, positional emitters, events (thunder, sirens, horns, train),
// foley (footsteps), driven-car engine and the music bed. Driven every frame from the system's update().
import {
  layoutFacades, getFacades, nearestFacadePoint, neonCandidates, gutterCandidates, shopCandidates,
  vendingCandidates, crowdPositions, Grid, trafficCars, trainSegments, posOf,
} from './probe.js';
import { mulberry32 } from './dsp.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const SOUND_C = 343;

// A small pool of positional loop emitters that get assigned to the nearest candidate points.
class EmitterPool {
  constructor(core, { buffer, count, dest, send = 0, hrtf = true, ref = 2, rolloff = 1, maxD = 20, rate = () => 1, vol = 1 }) {
    this.core = core; this.maxD = maxD; this.slots = []; this.vol = vol;
    for (let i = 0; i < count; i++) {
      const pan = core.panner(dest, { hrtf, ref, rolloff });
      if (send) pan.connect(core.gain(send, core.reverbSend));
      const name = typeof buffer === 'function' ? buffer(i) : buffer;
      const h = core.loop(name, pan, { gain: 0, rate: rate(i), offset: i * 0.377 + Math.random() * 0.3 });
      this.slots.push({ pan, h, key: null, target: 0, freeAt: 0, mul: 1, dip: 1 });
    }
    this._best = [];
  }
  assign(p, cands) {
    const K = this.slots.length, md2 = this.maxD * this.maxD, best = this._best;
    best.length = 0;
    if (cands) for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      const dx = c.x - p.x, dy = (c.y - p.y) * 0.5, dz = c.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > md2) continue;
      if (best.length < K) best.push({ c, d2 });
      else if (d2 < best[K - 1].d2) best[K - 1] = { c, d2 };
      else continue;
      best.sort((a, b) => a.d2 - b.d2);
    }
    const now = this.core.now;
    for (const s of this.slots) {
      if (s.key && !best.some((b) => b.c.key === s.key)) { s.key = null; s.target = 0; s.freeAt = now + 0.4; }
    }
    for (const b of best) {
      const s0 = this.slots.find((s) => s.key === b.c.key);
      if (s0) {
        s0.mul = b.c.mul ?? 1;
        if (b.c.moving) { const c = this.core; c.set(s0.pan.positionX, b.c.x, 0.2); c.set(s0.pan.positionY, b.c.y, 0.2); c.set(s0.pan.positionZ, b.c.z, 0.2); }
        continue;
      }
      const s = this.slots.find((q) => !q.key && now >= q.freeAt);
      if (!s) continue;
      s.key = b.c.key; s.target = 1; s.mul = b.c.mul ?? 1;
      this.core.setPos(s.pan, b.c.x, b.c.y, b.c.z);
    }
  }
  update(scale) {
    for (const s of this.slots) this.core.set(s.h.gain.gain, s.target * scale * s.mul * s.dip * this.vol, 0.15);
  }
  active() { return this.slots.filter((s) => s.key); }
}

export class Soundscape {
  constructor(core, ctx) {
    this.core = core; this.ctx = ctx;
    this.rng = mulberry32(2077);
    const c = core;
    const L = ctx.layout;
    this.L = L;
    this.fallbackFacades = layoutFacades(L);
    this.cands = { neon: null, gutter: null, shop: null, vending: null, facades: null, at: -99, sig: '' };
    this.listener = { x: 0, y: 1.7, z: 0 };
    this.t = 0; this.slowT = 0;
    this.inCarK = 0;

    // --- rain
    this.rainFar = c.loop('rainFar', c.exterior);
    this.rainNear = c.loop('rainNear', c.exterior);
    this.drops = c.loop('droplets', c.exterior);
    this.metalPan = c.panner(c.exterior, { hrtf: true, ref: 2.5, rolloff: 1.0 });
    this.metalPan.connect(c.gain(0.15, c.reverbSend));
    this.metal = c.loop('metalPatter', this.metalPan);
    this.metalPos = null;
    this.carRoof = c.loop('carRoof', c.interior);
    this.gutters = new EmitterPool(c, { buffer: 'gutter', count: 2, dest: c.exterior, send: 0.12, hrtf: false, ref: 1.5, rolloff: 1.3, maxD: 14 });

    // --- city bed
    this.traffic = c.loop('trafficBed', c.exterior);
    this.wind = c.loop('wind', c.exterior);
    this.crowdLP = c.filter('lowpass', 4000, 0.7, c.exterior);
    this.crowd = c.loop('crowdBabble', this.crowdLP);
    this.neon = new EmitterPool(c, { buffer: (i) => (i % 2 ? 'neonB' : 'neonA'), count: 4, dest: c.exterior, send: 0.1, hrtf: true, ref: 1.2, rolloff: 1.6, maxD: 16, rate: (i) => [1, 1, 1.2, 0.998][i], vol: 0.42 });
    this.vending = new EmitterPool(c, { buffer: 'vending', count: 2, dest: c.exterior, send: 0.08, hrtf: true, ref: 1.0, rolloff: 1.5, maxD: 12, vol: 0.6 });
    this.shops = new EmitterPool(c, { buffer: 'ramenShop', count: 2, dest: c.exterior, send: 0.25, hrtf: true, ref: 2.5, rolloff: 1.2, maxD: 26 });
    this.tires = new EmitterPool(c, { buffer: 'tireHiss', count: 3, dest: c.exterior, send: 0.2, hrtf: false, ref: 4, rolloff: 1.2, maxD: 45 });

    // --- trains (line sources along the elevated rail; one voice per visible train)
    this.trainVoices = [0, 1].map((i) => {
      const lp = c.filter('lowpass', 8000, 0.7);
      const pan = c.panner(c.exterior, { hrtf: false, ref: 25, rolloff: 1 });
      lp.connect(pan); pan.connect(c.gain(0.35, c.reverbSend));
      return { lp, pan, h: c.loop('trainRumble', lp, { offset: i * 0.5 }), prevX: null };
    });
    this.trainSim = { active: false, x: 0, dir: 1, speed: 22, next: 25 + this.rng() * 30 };
    this._segs = [];

    // --- events
    this.siren = null; this.nextSiren = 20 + this.rng() * 40;
    this.nextHorn = 6 + this.rng() * 12;
    this.nextZap = 4 + this.rng() * 8;
    this.thunderSeen = false; this.pendingThunder = null; this.prevLightning = 0;

    // --- foley
    this.stepPan = c.ac.createStereoPanner(); this.stepPan.connect(c.exterior);
    this.stepPan.connect(c.gain(0.1, c.reverbSend));
    this.stepSide = 1; this.lastStep = -1; this.stepEvents = false; this.stepAcc = 0; this.prevPlayer = null; this.playerSpeed = 0;

    // --- engine (driven car)
    this.engBus = c.gain(0, c.interior);
    this.engLP = c.filter('lowpass', 1500, 0.8, this.engBus);
    this.engLow = c.loop('engineLow', this.engLP, { gain: 0.8 });
    this.engHigh = c.loop('engineHigh', this.engLP, { gain: 0 });
    this.whine = c.ac.createOscillator(); this.whine.type = 'sine'; this.whine.frequency.value = 300;
    this.whineG = c.gain(0, this.engBus); this.whine.connect(this.whineG); this.whine.start();
    this.tireInLP = c.filter('lowpass', 2500, 0.7, c.interior);
    this.tireIn = c.loop('tireHiss', this.tireInLP);
    this.gear = 1; this.rpm = 900; this.carPrev = null; this.carSpeed = 0;

    // --- music (two adaptive Jiangnan beds cross-faded by district)
    this.musicMarket = c.loop('musicMarket', c.music, { gain: 0, offset: 0 });
    this.musicRiver = c.loop('musicRiver', c.music, { gain: 0, offset: 7.5 });
    this.musicK = 0;

    // event bus hooks
    this._on = [];
    const on = (type, fn) => { const h = (e) => { try { fn(e.detail || {}); } catch (err) { console.warn('[audio]', type, err); } }; ctx.events?.addEventListener?.(type, h); this._on.push([type, h]); };
    this.eventsEnabled = true; // verification harness can freeze random events for A/B measurements
    on('thunder', (d) => { this.thunderSeen = true; this.pendingThunder = null; if (this.eventsEnabled || d.force) this.thunder(d); });
    on('player-footstep', (d) => { this.stepEvents = true; this.step(d.sprint ? 1 : d.crouch ? 0.4 : 0.72, false); });
    on('player-land', (d) => { const k = clamp((d.impact || 4) / 9, 0.4, 1.3); this.step(k, true); setTimeout(() => this.step(k * 0.7, false), 70); });
    on('player-jump', () => this.step(0.45, false));
  }

  dispose() { for (const [t, h] of this._on) this.ctx.events?.removeEventListener?.(t, h); }

  setListener(pos) { this.listener.x = pos.x; this.listener.y = pos.y; this.listener.z = pos.z; }

  // ------------------------------------------------------------------ per-frame
  update(dt, ctx) {
    const c = this.core;
    if (!c.ac || c.ac.state !== 'running') return;
    this.t += dt;
    const p = this.listener;
    const w = ctx.weather || {};
    const rain = clamp(Number.isFinite(w.rain) ? w.rain : 1, 0, 1);
    const windMag = w.wind && typeof w.wind.length === 'function' ? w.wind.length() : 0.6;
    const ground = this.groundAt(p.x, p.z);
    const h = Math.max(0, p.y - ground);

    // car state
    const player = ctx.api?.player;
    const car = ctx.api?.vehicles?.activeCar || null;
    const inCar = player?.mode === 'car' || (!!car && player?.mode !== 'foot');
    this.inCarK += ((inCar ? 1 : 0) - this.inCarK) * Math.min(1, dt * 4);
    const paused = !!ctx.paused;
    c.set(c.exteriorLP.frequency, inCar ? 1000 : paused ? 1800 : 20000, 0.15);
    c.set(c.exterior.gain, inCar ? 0.55 : 1, 0.15);
    c.set(c.duck.gain, paused ? 0.6 : 1, 0.3);

    // rain
    c.set(this.rainFar.gain.gain, 0.5 * Math.pow(rain, 1.2));
    c.set(this.rainNear.gain.gain, 0.42 * Math.pow(rain, 1.5) * (1 - 0.4 * smooth(6, 30, h)));
    c.set(this.drops.gain.gain, 0.4 * smooth(0.02, 0.5, rain) * (1 - 0.5 * smooth(6, 30, h)));
    c.set(this.carRoof.gain.gain, 0.55 * Math.pow(rain, 1.1) * (inCar ? 1 : 0), 0.2);

    // city bed
    c.set(this.traffic.gain.gain, 0.2 * (1 + 0.7 * smooth(4, 40, h)) * (1 - 0.3 * this.inCarK), 0.3);
    c.set(this.wind.gain.gain, (0.05 + 0.4 * smooth(8, 40, h)) * clamp(windMag / 0.7, 0.3, 1.6), 0.5);

    // slow work at ~5 Hz: geometry queries + emitter assignment
    this.slowT -= dt;
    if (this.slowT <= 0) { this.slowT = 0.1; this.slow(ctx, p, rain, h); }

    this.neon.update(0.55 * (1 - 0.5 * this.inCarK));
    this.vending.update(0.4);
    this.shops.update(0.5);
    this.gutters.update(0.5 * Math.pow(rain, 0.7));
    this.tires.update(0.6 * (0.3 + 0.7 * (w.wetness ?? 1)));
    if (this.metalPos) c.set(this.metal.gain.gain, 0.7 * rain * this.metalPos.k, 0.25);
    else c.set(this.metal.gain.gain, 0, 0.3);
    c.set(this.crowd.gain.gain, 0.07 * (this.crowdDensity ?? 0), 0.6);

    // adaptive Jiangnan score: riverside vs. night-market, ducked inside a car / while paused
    const riverK = p.x > 118 ? 1 : 0;
    this.musicK += (riverK - this.musicK) * Math.min(1, dt * 0.35);
    const mDuck = (inCar ? 0.45 : 1) * (paused ? 0.35 : 1);
    c.set(this.musicMarket.gain.gain, 0.26 * (1 - this.musicK) * mDuck, 1.4);
    c.set(this.musicRiver.gain.gain, 0.22 * this.musicK * mDuck, 1.4);

    this.updateTrain(dt, ctx, p);
    this.updateEvents(dt, ctx, p, w);
    this.updateFootFallback(dt, player, inCar);
    this.updateEngine(dt, ctx, car, inCar);
  }

  groundAt(x, z) {
    try { const g = this.ctx.api?.ground?.heightAt?.(x, z); if (Number.isFinite(g)) return g; } catch { /* */ }
    return 0;
  }

  // Geometry queries + emitter assignment, staggered over 3 phases (~3.3 Hz each) and accelerated by hash grids.
  slow(ctx, p, rain, h) {
    const phase = (this._phase = ((this._phase ?? -1) + 1) % 3);
    const facades = getFacades(ctx, this.fallbackFacades);
    if (phase === 0) {
      // rebuild candidates only when the source data changed (other systems may finish building later)
      const sig = (facades.length) + ':' + (ctx.api?.signage?.lights?.cands?.length ?? -1) + ':' + (ctx.api?.buildings ? 1 : 0);
      if (sig !== this.cands.sig && this.t - this.cands.at > 2) {
        this.cands.sig = sig; this.cands.at = this.t;
        this.cands.neon = Grid.of(neonCandidates(ctx, facades));
        this.cands.gutter = Grid.of(gutterCandidates(facades));
        this.cands.shop = Grid.of(shopCandidates(ctx, facades));
        this.cands.vending = Grid.of(vendingCandidates(ctx, this.L));
        this.cands.facades = Grid.ofFacades(facades);
      }
      const q = this._q || (this._q = []);
      this.neon.assign(p, this.cands.neon?.query(p.x, p.z, 16, q));
      this.vending.assign(p, this.cands.vending?.query(p.x, p.z, 12, q));
      this.shops.assign(p, this.cands.shop?.query(p.x, p.z, 26, q));
      this.gutters.assign(p, this.cands.gutter?.query(p.x, p.z, 14, q));
    } else if (phase === 1) {
      // rain on awnings / metal: nearest facade
      const near = this.cands.facades ? this.cands.facades.query(p.x, p.z, 14, this._fq || (this._fq = [])) : facades;
      const nf = nearestFacadePoint(near, p, 14);
      if (nf) {
        const k = 1 - smooth(1.5, 12, nf.d);
        const c = this.core;
        if (!this.metalPos) c.setPos(this.metalPan, nf.x, nf.y, nf.z);
        else { c.set(this.metalPan.positionX, nf.x, 0.3); c.set(this.metalPan.positionY, nf.y, 0.3); c.set(this.metalPan.positionZ, nf.z, 0.3); }
        this.metalPos = { k };
      } else this.metalPos = null;

      // crowd density (crowd API positions if exposed, else district heuristics from the layout)
      const peds = crowdPositions(ctx);
      let dens = 0;
      if (peds && peds.length) {
        const tmp = { x: 0, y: 0, z: 0 };
        if (ArrayBuffer.isView(peds)) {
          for (let i = 0; i + 2 < peds.length; i += 3) { const d = Math.hypot(peds[i] - p.x, peds[i + 2] - p.z); if (d < 25) dens += 1 - d / 25; }
        } else for (let i = 0; i < peds.length; i++) { const q = posOf(peds[i], tmp); if (!q) continue; const d = Math.hypot(q.x - p.x, q.z - p.z); if (d < 25) dens += 1 - d / 25; }
        dens = clamp(dens / 5, 0, 1);
      } else {
        const L = this.L;
        const onAvenue = Math.abs(p.x - L.avenue.x) < 16 && p.z < L.avenue.zStart && p.z > L.avenue.zEnd;
        const inAlley = Math.abs(p.z - L.alley.z) < 6 && p.x < L.alley.xStart + 2 && p.x > L.alley.xEnd;
        const onProm = p.x > L.promenade.xMin - 4 && p.x < L.promenade.xMax + 4;
        dens = onAvenue ? 0.6 : inAlley ? 0.45 : onProm ? 0.35 : 0.15;
      }
      this.crowdDensity = dens * (1 - 0.8 * smooth(5, 30, h)) * (0.6 + 0.4 * (1 - rain * 0.5));
      this.core.set(this.crowdLP.frequency, 1500 + 3000 * dens, 0.5);
    } else {
      // moving traffic cars → tyre hiss emitters (cheap bbox reject before anything else)
      const cars = trafficCars(ctx);
      if (!cars) { this.tires.assign(p, null); return; }
      const act = ctx.api?.vehicles?.activeCar;
      const out = this._tq || (this._tq = []);
      out.length = 0;
      const prevMap = this._carPrev || (this._carPrev = new WeakMap());
      for (let i = 0; i < cars.length && i < 2000; i++) {
        const car = cars[i];
        if (!car || car === act) continue;
        const pos = car.position?.isVector3 ? car.position : null;
        const q = pos || posOf(car);
        if (!q || Math.abs(q.x - p.x) > 45 || Math.abs(q.z - p.z) > 45) continue;
        let v = Number.isFinite(car.speed) ? Math.abs(car.speed) : NaN;
        if (!Number.isFinite(v)) {
          const prev = prevMap.get(car);
          v = prev ? Math.hypot(q.x - prev.x, q.z - prev.z) / 0.3 : 0;
          prevMap.set(car, { x: q.x, z: q.z });
        }
        if (v > 2) out.push({ x: q.x, y: 0.4, z: q.z, key: car, mul: smooth(2, 25, v), moving: true });
      }
      this.tires.assign(p, out);
    }
  }

  // ------------------------------------------------------------------ train
  updateTrain(dt, ctx, p) {
    const c = this.core;
    const R = this.L.elevatedRail || { z: -140, height: 14, xStart: -400, xEnd: 400 };
    let segs = trainSegments(ctx, this._segs);
    if (!segs) {
      // landmarks doesn't expose trains → simulated schedule along the elevated rail
      const s = this.trainSim;
      segs = this._segs; segs.length = 0;
      if (!s.active) {
        if (this.eventsEnabled) s.next -= dt;
        if (s.next <= 0) { s.active = true; s.dir = this.rng() < 0.5 ? 1 : -1; s.x = s.dir > 0 ? R.xStart - 300 : R.xEnd + 300; s.speed = 18 + this.rng() * 8; }
      } else {
        s.x += s.dir * s.speed * dt;
        if ((s.dir > 0 && s.x > R.xEnd + 300) || (s.dir < 0 && s.x < R.xStart - 300)) { s.active = false; s.next = 60 + this.rng() * 70; }
      }
      if (s.active) segs.push({ x0: s.x - 55, x1: s.x + 55, y: R.height + 1.5, z: R.z });
    } else if (this.trainSim.active) {
      // forced test pass on top of real trains
      const s = this.trainSim; s.x += s.dir * s.speed * dt;
      if (s.x > R.xEnd + 300) s.active = false; else segs.push({ x0: s.x - 55, x1: s.x + 55, y: R.height + 1.5, z: R.z });
    }
    // nearest segments get the voices
    if (segs.length > 2) segs.sort((a, b) => Math.abs(clamp(p.x, a.x0, a.x1) - p.x) + Math.abs(a.z - p.z) - (Math.abs(clamp(p.x, b.x0, b.x1) - p.x) + Math.abs(b.z - p.z)));
    for (let i = 0; i < this.trainVoices.length; i++) {
      const v = this.trainVoices[i], sg = segs[i];
      if (!sg) { c.set(v.h.gain.gain, 0, 0.5); v.prevX = null; continue; }
      const mid = (sg.x0 + sg.x1) / 2;
      const speed = v.prevX === null ? 21 : Math.abs(mid - v.prevX) / Math.max(dt, 1e-3);
      v.prevX = mid;
      // closest point on the train body (line source along X)
      const px = clamp(p.x, sg.x0, sg.x1);
      c.set(v.pan.positionX, px, 0.1); c.set(v.pan.positionY, sg.y, 0.1); c.set(v.pan.positionZ, sg.z, 0.1);
      const d = Math.hypot(px - p.x, sg.y - p.y, sg.z - p.z);
      const moving = smooth(1, 8, Math.min(speed, 60));
      c.set(v.h.gain.gain, 1.6 * moving * (1 - smooth(500, 900, d)), 0.3);
      if (v.h.src) c.set(v.h.src.playbackRate, clamp(0.75 + Math.min(speed, 40) / 80, 0.7, 1.3), 0.3);
      c.set(v.lp.frequency, clamp(14000 * Math.exp(-d / 180), 500, 14000), 0.2);
    }
  }

  // ------------------------------------------------------------------ events
  updateEvents(dt, ctx, p, w) {
    const c = this.core;
    if (this.siren) this.updateSiren(dt, p);
    if (!this.eventsEnabled) return;
    // fallback thunder from lightning flashes (only if the weather system never dispatches 'thunder')
    const lt = w.lightning || 0;
    if (!this.thunderSeen && lt > 0.5 && this.prevLightning <= 0.5 && !this.pendingThunder) this.pendingThunder = { t: 2 + this.rng() * 3, d: { intensity: lt, distance: 2500 + this.rng() * 3000, delay: 0 } };
    this.prevLightning = lt;
    if (this.pendingThunder) { this.pendingThunder.t -= dt; if (this.pendingThunder.t <= 0) { const d = this.pendingThunder.d; this.pendingThunder = null; this.thunder(d); } }

    // sirens
    this.nextSiren -= dt;
    if (!this.siren && this.nextSiren <= 0) { this.spawnSiren(p); this.nextSiren = 45 + this.rng() * 80; }

    // distant horns
    this.nextHorn -= dt;
    if (this.nextHorn <= 0) { this.nextHorn = 7 + this.rng() * 22; this.horn(p); }

    // neon flicker zaps
    this.nextZap -= dt;
    if (this.nextZap <= 0) {
      this.nextZap = 3 + this.rng() * 12;
      const act = this.neon.active();
      if (act.length) {
        const s = act[(this.rng() * act.length) | 0];
        c.oneShot('neonZap', s.pan, { gain: 0.3, rate: 0.9 + this.rng() * 0.2 });
        s.dip = 0.25; setTimeout(() => { s.dip = 1; }, 120 + this.rng() * 200);
      }
    }
  }

  thunder(d) {
    const c = this.core;
    const dist = Number.isFinite(d.distance) ? d.distance : 3000;
    const realDelay = Number.isFinite(d.delay) ? d.delay : dist / SOUND_C;
    const delay = Math.min(realDelay, 1 + realDelay * 0.4); // compressed so the flash→rumble link stays readable
    const name = dist < 2600 ? 'thunderNear' : dist < 4800 ? 'thunderMid' : 'thunderFar';
    const inten = clamp(Number.isFinite(d.intensity) ? d.intensity : 0.6, 0.05, 1);
    const lp = c.filter('lowpass', clamp(7000 * Math.exp(-(dist - 1500) / 2500), 350, 7000), 0.6, c.exterior);
    lp.connect(c.gain(0.25, c.reverbSend));
    const s = c.oneShot(name, lp, { gain: 0.45 + 0.8 * inten, rate: 0.92 + this.rng() * 0.12, when: delay });
    if (s) s.addEventListener('ended', () => { try { lp.disconnect(); } catch { /* */ } });
    else try { lp.disconnect(); } catch { /* */ }
  }

  // test hooks (verification harness): a siren passing the listener along the avenue, a train pass overhead
  forceSiren() {
    const p = this.listener, L = this.L;
    if (this.siren) { this.siren.s = this.siren.total; this.updateSiren(0.016, p); }
    this.spawnSiren(p, { ax: L.avenue.x + 2, az: p.z - 130, bx: L.avenue.x + 2, bz: p.z + 200, axis: 'z', line: L.avenue.x }, false, 26);
  }
  forceTrain() { const s = this.trainSim; s.active = true; s.dir = 1; s.speed = 22; s.x = this.listener.x - 130; }

  spawnSiren(p, forcePath, forceRev, forceSpeed) {
    const c = this.core, r = this.rng, L = this.L;
    const paths = [];
    paths.push({ ax: L.avenue.x + 2, az: L.avenue.zEnd, bx: L.avenue.x + 2, bz: L.avenue.zStart + 80, axis: 'z', line: L.avenue.x });
    for (const z of L.crossStreets.zs) paths.push({ ax: L.crossStreets.xStart - 100, az: z, bx: L.crossStreets.xEnd + 100, bz: z, axis: 'x', line: z });
    paths.push({ ax: -400, az: L.expressway.z, bx: 400, bz: L.expressway.z, axis: 'x', line: L.expressway.z, y: L.expressway.height + 1 });
    const path = forcePath || paths[(r() * paths.length) | 0];
    const rev = forceRev ?? r() < 0.5;
    const a = rev ? { x: path.bx, z: path.bz } : { x: path.ax, z: path.az }, b = rev ? { x: path.ax, z: path.az } : { x: path.bx, z: path.bz };
    const total = Math.hypot(b.x - a.x, b.z - a.z);
    const speed = forceSpeed || 18 + r() * 10;
    const lp = c.filter('lowpass', 6000, 0.7);
    const occ = c.filter('lowpass', 20000, 0.5);
    const pan = c.panner(c.exterior, { hrtf: false, ref: 40, rolloff: 1.1 });
    lp.connect(occ).connect(pan);
    const send = c.gain(0.55, c.reverbSend); occ.connect(send);
    const h = c.loop(forcePath || r() < 0.6 ? 'sirenWail' : 'sirenHiLo', lp, { gain: 0, offset: r() });
    this.siren = { a, b, total, speed, s: 0, y: path.y ?? 1.5, path, h, lp, occ, pan, send, prevD: null };
  }

  updateSiren(dt, p) {
    const c = this.core, S = this.siren;
    S.s += S.speed * dt;
    const u = S.s / S.total;
    if (u >= 1) {
      c.set(S.h.gain.gain, 0, 0.2);
      const z = S; this.siren = null;
      setTimeout(() => { try { z.h.src?.stop(); z.h.gain.disconnect(); z.lp.disconnect(); z.occ.disconnect(); z.pan.disconnect(); z.send.disconnect(); } catch { /* */ } }, 1500);
      return;
    }
    const x = S.a.x + (S.b.x - S.a.x) * u, z = S.a.z + (S.b.z - S.a.z) * u;
    c.setPos(S.pan, x, S.y, z);
    const d = Math.hypot(x - p.x, S.y - p.y, z - p.z);
    if (S.prevD !== null && S.h.src) {
      const vr = (d - S.prevD) / Math.max(dt, 1e-3);
      c.set(S.h.src.playbackRate, clamp(SOUND_C / (SOUND_C + vr), 0.8, 1.25), 0.06);
    }
    S.prevD = d;
    const env = smooth(0, 0.08, u) * (1 - smooth(0.92, 1, u));
    c.set(S.h.gain.gain, 1.1 * env, 0.1);
    c.set(S.lp.frequency, clamp(16000 * Math.exp(-d / 260), 900, 16000), 0.1);
    const sameStreet = S.path.axis === 'z' ? Math.abs(p.x - S.path.line) < 12 : Math.abs(p.z - S.path.line) < 10;
    c.set(S.occ.frequency, sameStreet || p.y > 15 ? 20000 : 1400, 0.4);
  }

  horn(p) {
    const c = this.core, r = this.rng, L = this.L;
    const ang = r() * Math.PI * 2, dist = 40 + r() * 180;
    let x = p.x + Math.cos(ang) * dist, z = p.z + Math.sin(ang) * dist;
    if (r() < 0.6) x = L.avenue.x + (r() - 0.5) * 8; // mostly on the avenue
    const lp = c.filter('lowpass', clamp(9000 * Math.exp(-dist / 150), 900, 9000), 0.7);
    const pan = c.panner(c.exterior, { hrtf: false, ref: 15, rolloff: 1 });
    lp.connect(pan); const send = c.gain(0.5, c.reverbSend); lp.connect(send);
    c.setPos(pan, x, 1.2, z);
    const s = c.oneShot('horn' + ((r() * 3) | 0), lp, { gain: 0.5 + r() * 0.4, rate: 0.95 + r() * 0.1 });
    const cleanup = () => { try { lp.disconnect(); pan.disconnect(); send.disconnect(); } catch { /* */ } };
    if (s) s.addEventListener('ended', cleanup); else cleanup();
  }

  // ------------------------------------------------------------------ foley
  step(k, heavy) {
    const c = this.core;
    if (!c.ac || this.inCarK > 0.5) return;
    const r = this.rng;
    let puddle = heavy || r() < 0.18;
    try {
      const pl = this.ctx.api?.player?.object?.position;
      const g = this.ctx.api?.ground;
      const pv = pl && (g?.puddleAt?.(pl.x, pl.z) ?? g?.puddle?.(pl.x, pl.z));
      if (typeof pv === 'number') puddle = heavy || pv > 0.5 || r() < 0.06;
      else if (typeof pv === 'boolean') puddle = heavy || pv;
    } catch { /* */ }
    let idx;
    do { idx = (r() * (puddle ? 4 : 8)) | 0; } while (!puddle && idx === this.lastStep);
    this.lastStep = puddle ? -1 : idx;
    this.stepSide = -this.stepSide;
    c.set(this.stepPan.pan, this.stepSide * 0.12, 0.01);
    const view = this.ctx.api?.player?.view;
    const g = k * (view === 'tp' ? 0.75 : 1) * (puddle ? 1.0 : 0.8);
    c.oneShot((puddle ? 'puddle' : 'step') + idx, this.stepPan, { gain: g, rate: 0.92 + r() * 0.16 });
  }

  // distance-based footsteps if the player system doesn't emit 'player-footstep' events
  updateFootFallback(dt, player, inCar) {
    const pos = player?.object?.position;
    if (!pos) return;
    if (this.prevPlayer) {
      const dx = pos.x - this.prevPlayer.x, dz = pos.z - this.prevPlayer.z, dy = pos.y - this.prevPlayer.y;
      const sp = Math.hypot(dx, dz) / Math.max(dt, 1e-3);
      this.playerSpeed += (sp - this.playerSpeed) * Math.min(1, dt * 8);
      if (!this.stepEvents && !inCar && player.mode !== 'car' && sp < 15 && Math.abs(dy) < 0.15) {
        this.stepAcc += Math.hypot(dx, dz);
        const stride = clamp(0.55 + 0.11 * this.playerSpeed, 0.6, 1.6);
        if (this.playerSpeed > 0.8 && this.stepAcc > stride) { this.stepAcc = 0; this.step(clamp(this.playerSpeed / 6, 0.4, 1), false); }
      }
    }
    this.prevPlayer = { x: pos.x, y: pos.y, z: pos.z };
  }

  // ------------------------------------------------------------------ engine
  updateEngine(dt, ctx, car, inCar) {
    const c = this.core;
    const on = inCar && car;
    if (!on) {
      c.set(this.engBus.gain, 0, 0.25); c.set(this.tireIn.gain.gain, 0, 0.25);
      this.carPrev = null; this.carSpeed = 0;
      return;
    }
    let speed = Number.isFinite(car.speed) ? Math.abs(car.speed) : NaN;
    const q = posOf(car);
    if (!Number.isFinite(speed)) {
      if (q && this.carPrev && dt > 0) speed = Math.hypot(q.x - this.carPrev.x, q.z - this.carPrev.z) / dt;
      else speed = 0;
      if (speed > 120) speed = 0; // teleport
    }
    if (q) this.carPrev = { x: q.x, z: q.z };
    this.carSpeed += (speed - this.carSpeed) * Math.min(1, dt * 5);
    const v = this.carSpeed;
    const inp = ctx.input;
    let throttle = Number.isFinite(car.throttle) ? Math.abs(car.throttle) : (inp?.down?.('KeyW') || inp?.down?.('ArrowUp') || inp?.down?.('KeyS') || inp?.down?.('ArrowDown')) ? 1 : 0;
    throttle = clamp(throttle, 0, 1);
    // simple 6-speed gearbox
    const ratios = [0, 3.4, 2.2, 1.6, 1.25, 1.0, 0.82];
    const wheelRpm = (v / (2 * Math.PI * 0.34)) * 60 * 3.6;
    let rpm = wheelRpm * ratios[this.gear];
    if (rpm > 6200 && this.gear < 6) this.gear++;
    else if (rpm < 2000 && this.gear > 1) this.gear--;
    rpm = Math.max(850 + throttle * 600 * (v < 1 ? 1 : 0), wheelRpm * ratios[this.gear]);
    rpm = Math.min(rpm, 7200);
    this.rpm += (rpm - this.rpm) * Math.min(1, dt * 6);
    const rate = this.rpm / 2000;
    if (this.engLow.src) c.set(this.engLow.src.playbackRate, rate, 0.04);
    if (this.engHigh.src) c.set(this.engHigh.src.playbackRate, rate, 0.04);
    const hi = smooth(2200, 5200, this.rpm) * (0.35 + 0.65 * throttle);
    c.set(this.engLow.gain.gain, 0.9 * (1 - 0.6 * hi), 0.08);
    c.set(this.engHigh.gain.gain, 0.8 * hi, 0.08);
    c.set(this.engLP.frequency, 600 + 2600 * throttle + this.rpm * 0.25, 0.08);
    c.set(this.engBus.gain, 0.42 + 0.25 * throttle, 0.15);
    c.set(this.whine.frequency, 260 + v * 42, 0.05);
    c.set(this.whineG.gain, 0.02 * smooth(1, 30, v), 0.1);
    c.set(this.tireIn.gain.gain, 0.45 * smooth(0.5, 35, v), 0.1);
  }
}
